import { test, expect, beforeEach, afterEach } from '@jest/globals';
import { mkdtempSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { openStore, isAvailable } from '../src/store/index.js';
import { storePath } from '../src/store/path.js';

/**
 * Phase 1 — the store layer, exercised with no network at all.
 *
 * The invariant these tests exist to protect is atomicity in `syncFolder`: a
 * cursor that advances without its rows would make an interrupted sync skip a
 * uid range forever, silently. Everything else here is shape-checking.
 */

const envelope = (uid, subject, date, extra = {}) => ({
  id: uid,
  messageId: `<${uid}@example.com>`,
  from: { name: 'AWS Billing', addr: 'billing@aws.com' },
  to: { name: null, addr: 'me@example.com' },
  subject,
  date,
  flags: [],
  hasAttachment: false,
  ...extra,
});

const cursor = (over = {}) => ({
  uidValidity: 42,
  uidNext: 100,
  highestModseq: '9007199254740993',
  lastSyncedAt: '2026-08-10T12:00:00.000Z',
  ...over,
});

const ref = { account: 'work', folder: 'INBOX' };

/** @type {Awaited<ReturnType<typeof openStore>>} */
let store;

beforeEach(() => {
  store = openStore({ path: ':memory:' });
});

afterEach(() => {
  store?.close();
});

// -- availability + open -------------------------------------------------------

test("isAvailable reports node:sqlite presence on this runtime", () => {
  expect(isAvailable()).toBe(true);
});

test("openStore creates the file 0600 under the configured dir", () => {
  const dir = mkdtempSync(join(tmpdir(), 'fob-email-store-'));
  const file = join(dir, 'nested', 'sync.db');
  const s = openStore({ path: file });
  try {
    expect(existsSync(file)).toBe(true);
    expect(statSync(file).mode & 0o777).toBe(0o600);
  } finally {
    s.close();
  }
});

test('storePath honours FOB_EMAIL_CONFIG_DIR and is resolved per call', () => {
  const prev = process.env.FOB_EMAIL_CONFIG_DIR;
  process.env.FOB_EMAIL_CONFIG_DIR = '/tmp/fob-test-dir';
  try {
    expect(storePath()).toBe('/tmp/fob-test-dir/sync.db');
  } finally {
    if (prev === undefined) delete process.env.FOB_EMAIL_CONFIG_DIR;
    else process.env.FOB_EMAIL_CONFIG_DIR = prev;
  }
});

// -- cursors -------------------------------------------------------------------

test('getFolder returns null for a folder that was never synced', () => {
  expect(store.getFolder(ref)).toBeNull();
});

test('syncFolder records the cursor, round-tripping modseq losslessly', () => {
  // Beyond Number.MAX_SAFE_INTEGER — the reason highest_modseq is TEXT.
  const big = '18446744073709551615';
  store.syncFolder({ ...ref, messages: [], cursor: cursor({ highestModseq: big }) });

  const f = store.getFolder(ref);
  expect(f.uidValidity).toBe(42);
  expect(f.uidNext).toBe(100);
  expect(f.highestModseq).toBe(big);
  expect(f.lastSyncedAt).toBe('2026-08-10T12:00:00.000Z');
});

test('listFolders reports every synced folder across accounts', () => {
  store.syncFolder({ ...ref, cursor: cursor() });
  store.syncFolder({ account: 'personal', folder: 'Archive', cursor: cursor({ uidValidity: 7 }) });

  expect(store.listFolders().map((f) => `${f.account}/${f.folder}`)).toEqual([
    'personal/Archive',
    'work/INBOX',
  ]);
});

// -- messages ------------------------------------------------------------------

test('syncFolder upserts envelopes and listMessages returns them newest first', () => {
  store.syncFolder({
    ...ref,
    messages: [
      envelope(1, 'oldest', '2026-01-01T00:00:00.000Z'),
      envelope(3, 'newest', '2026-01-03T00:00:00.000Z'),
      envelope(2, 'middle', '2026-01-02T00:00:00.000Z'),
    ],
    cursor: cursor(),
  });

  expect(store.listMessages(ref).map((m) => m.subject)).toEqual(['newest', 'middle', 'oldest']);
  expect(store.countMessages(ref)).toBe(3);
});

test('cached envelopes match the live engine shape', () => {
  store.syncFolder({
    ...ref,
    messages: [envelope(1, 'Invoice INV-0412', '2026-07-24T10:23:01.000Z', {
      flags: ['\\Seen', '\\Flagged'],
      hasAttachment: true,
    })],
    cursor: cursor(),
  });

  expect(store.listMessages(ref)[0]).toEqual({
    id: 1,
    messageId: '<1@example.com>',
    from: { name: 'AWS Billing', addr: 'billing@aws.com' },
    to: { name: null, addr: 'me@example.com' },
    subject: 'Invoice INV-0412',
    date: '2026-07-24T10:23:01.000Z',
    flags: ['\\Seen', '\\Flagged'],
    hasAttachment: true,
  });
});

test('re-syncing the same uid updates in place rather than duplicating', () => {
  store.syncFolder({ ...ref, messages: [envelope(1, 'unread', '2026-01-01T00:00:00.000Z')], cursor: cursor() });
  store.syncFolder({
    ...ref,
    messages: [envelope(1, 'unread', '2026-01-01T00:00:00.000Z', { flags: ['\\Seen'] })],
    cursor: cursor(),
  });

  expect(store.countMessages(ref)).toBe(1);
  expect(store.listMessages(ref)[0].flags).toEqual(['\\Seen']);
});

test('listMessages honours the limit', () => {
  store.syncFolder({
    ...ref,
    messages: [1, 2, 3, 4, 5].map((u) => envelope(u, `s${u}`, `2026-01-0${u}T00:00:00.000Z`)),
    cursor: cursor(),
  });
  expect(store.listMessages({ ...ref, limit: 2 }).map((m) => m.subject)).toEqual(['s5', 's4']);
});

test('vanished uids are deleted', () => {
  store.syncFolder({
    ...ref,
    messages: [1, 2, 3].map((u) => envelope(u, `s${u}`, `2026-01-0${u}T00:00:00.000Z`)),
    cursor: cursor(),
  });
  store.syncFolder({ ...ref, vanished: [2], cursor: cursor() });

  expect(store.listMessages(ref).map((m) => m.id)).toEqual([3, 1]);
});

test('uidsIn reports mirrored uids for the current uidValidity only', () => {
  store.syncFolder({
    ...ref,
    messages: [1, 2].map((u) => envelope(u, `s${u}`, `2026-01-0${u}T00:00:00.000Z`)),
    cursor: cursor(),
  });

  expect(store.uidsIn({ ...ref, uidValidity: 42 }).sort()).toEqual([1, 2]);
  expect(store.uidsIn({ ...ref, uidValidity: 99 })).toEqual([]);
});

// -- D4: a UIDVALIDITY roll invalidates every id ------------------------------

test('purge drops prior rows so a UIDVALIDITY roll cannot reinterpret old ids', () => {
  store.syncFolder({
    ...ref,
    messages: [1, 2].map((u) => envelope(u, `old-${u}`, `2026-01-0${u}T00:00:00.000Z`)),
    cursor: cursor({ uidValidity: 42 }),
  });

  store.syncFolder({
    ...ref,
    purge: true,
    messages: [envelope(1, 'fresh', '2026-02-01T00:00:00.000Z')],
    cursor: cursor({ uidValidity: 43 }),
  });

  expect(store.countMessages(ref)).toBe(1);
  expect(store.listMessages(ref)[0].subject).toBe('fresh');
  expect(store.getFolder(ref).uidValidity).toBe(43);
});

// -- atomicity: the invariant the whole mirror rests on ------------------------

test('a failed syncFolder advances neither rows nor cursor', () => {
  store.syncFolder({ ...ref, messages: [envelope(1, 'first', '2026-01-01T00:00:00.000Z')], cursor: cursor({ uidNext: 50 }) });

  // A message whose flags cannot be serialized blows up mid-transaction, after
  // some rows have already been written.
  const poison = envelope(2, 'second', '2026-01-02T00:00:00.000Z');
  Object.defineProperty(poison, 'flags', {
    get() {
      throw new Error('boom');
    },
  });

  expect(() =>
    store.syncFolder({
      ...ref,
      messages: [envelope(3, 'third', '2026-01-03T00:00:00.000Z'), poison],
      cursor: cursor({ uidNext: 999 }),
    }),
  ).toThrow('boom');

  // Rolled back whole: uid 3 is absent and the cursor still reads 50, so the
  // next sync re-fetches that range instead of skipping it forever.
  expect(store.countMessages(ref)).toBe(1);
  expect(store.listMessages(ref).map((m) => m.id)).toEqual([1]);
  expect(store.getFolder(ref).uidNext).toBe(50);
});

// -- clear ---------------------------------------------------------------------

test('clear drops one folder, leaving other folders intact', () => {
  store.syncFolder({ ...ref, messages: [envelope(1, 'a', '2026-01-01T00:00:00.000Z')], cursor: cursor() });
  store.syncFolder({ account: 'work', folder: 'Archive', messages: [envelope(1, 'b', '2026-01-01T00:00:00.000Z')], cursor: cursor() });

  store.clear(ref);

  expect(store.getFolder(ref)).toBeNull();
  expect(store.countMessages(ref)).toBe(0);
  expect(store.countMessages({ account: 'work', folder: 'Archive' })).toBe(1);
});

test('clear with only an account drops all of that account', () => {
  store.syncFolder({ ...ref, messages: [envelope(1, 'a', '2026-01-01T00:00:00.000Z')], cursor: cursor() });
  store.syncFolder({ account: 'personal', folder: 'INBOX', messages: [envelope(1, 'b', '2026-01-01T00:00:00.000Z')], cursor: cursor() });

  store.clear({ account: 'work' });

  expect(store.listFolders().map((f) => f.account)).toEqual(['personal']);
});

test('clear with no argument empties the whole mirror', () => {
  store.syncFolder({ ...ref, messages: [envelope(1, 'a', '2026-01-01T00:00:00.000Z')], cursor: cursor() });
  store.clear();
  expect(store.listFolders()).toEqual([]);
});

// -- durability across reopen --------------------------------------------------

test("a mirror survives close and reopen", () => {
  const dir = mkdtempSync(join(tmpdir(), 'fob-email-store-'));
  const file = join(dir, 'sync.db');

  const first = openStore({ path: file });
  first.syncFolder({ ...ref, messages: [envelope(1, 'persisted', '2026-01-01T00:00:00.000Z')], cursor: cursor() });
  first.close();

  const second = openStore({ path: file });
  try {
    expect(second.listMessages(ref)[0].subject).toBe('persisted');
    expect(second.getFolder(ref).uidValidity).toBe(42);
  } finally {
    second.close();
  }
});
