import { test, expect, beforeEach, afterEach } from '@jest/globals';

import { buildSync } from '../src/resources/sync.js';
import { openStore } from '../src/store/index.js';
import { listEmailsHandler } from '../src/cli/emails/list.js';
import { searchEmailsHandler } from '../src/cli/emails/search.js';
import { captureOutput } from './helpers.js';

/**
 * Phase 4 — `--cached` reads.
 *
 * The rule under test is S1: cached is opt-in and **never silently falls back to
 * live**. A `--cached` read that quietly hit the network would make the flag
 * meaningless for the scripting case it exists to serve.
 */

/** @type {any} */
let store;
const now = () => '2026-08-10T12:00:00.000Z';

const row = (uid, subject, extra = {}) => ({
  id: uid,
  messageId: `<${uid}@x>`,
  from: { name: 'AWS', addr: 'billing@aws.com' },
  to: null,
  subject,
  date: `2026-01-0${uid}T00:00:00.000Z`,
  flags: [],
  hasAttachment: false,
  threadId: null,
  refs: [],
  ...extra,
});

/** Seed the mirror directly — Phase 2/3 already cover how it gets filled. */
function seed(messages, { account = 'work', folder = 'INBOX' } = {}) {
  store.syncFolder({
    account,
    folder,
    messages,
    cursor: { uidValidity: 42, uidNext: 99, highestModseq: null, lastSyncedAt: now() },
  });
}

/** A client exposing a real sync namespace over the seeded store, plus a live spy. */
function clientWith({ live = [], account = 'work' } = {}) {
  const calls = { live: 0, closed: 0 };
  const sync = buildSync(/** @type {any} */ ({}), store, { account, now });
  return {
    calls,
    sync,
    emails: {
      list: async () => {
        calls.live += 1;
        return { data: live, uidValidity: 42, folder: 'INBOX' };
      },
      search: async () => {
        calls.live += 1;
        return { data: live, uidValidity: 42, folder: 'INBOX' };
      },
    },
    close: async () => {
      calls.closed += 1;
    },
  };
}

beforeEach(() => {
  store = openStore({ path: ':memory:' });
});
afterEach(() => store?.close());

// -- the read verb -------------------------------------------------------------

test('read serves mirrored envelopes newest first', () => {
  seed([row(1, 'oldest'), row(3, 'newest'), row(2, 'middle')]);
  const sync = buildSync(/** @type {any} */ ({}), store, { account: 'work', now });

  const res = sync.read({ folder: 'INBOX' });
  expect(res.cached).toBe(true);
  expect(res.syncedAt).toBe(now());
  expect(res.data.map((m) => m.subject)).toEqual(['newest', 'middle', 'oldest']);
});

test('read throws for a folder that was never synced, naming the fix', () => {
  const sync = buildSync(/** @type {any} */ ({}), store, { account: 'work', now });
  expect(() => sync.read({ folder: 'Archive' })).toThrow(/sync run --folder Archive/);
});

test('read filters unseen without matching keyword flags', () => {
  seed([
    row(1, 'read', { flags: ['\\Seen'] }),
    row(2, 'unread', { flags: [] }),
    // A user keyword containing "Seen" must not be mistaken for the system flag.
    row(3, 'keyworded', { flags: ['NotSeenByMe'] }),
  ]);
  const sync = buildSync(/** @type {any} */ ({}), store, { account: 'work', now });

  expect(sync.read({ folder: 'INBOX', unseen: true }).data.map((m) => m.subject).sort()).toEqual([
    'keyworded',
    'unread',
  ]);
});

test('read filters by from, subject, and since', () => {
  seed([
    row(1, 'Invoice', { from: { name: 'AWS', addr: 'billing@aws.com' } }),
    row(2, 'Receipt', { from: { name: null, addr: 'noreply@stripe.com' } }),
    row(3, 'Invoice again', { from: { name: null, addr: 'billing@aws.com' } }),
  ]);
  const sync = buildSync(/** @type {any} */ ({}), store, { account: 'work', now });

  expect(sync.read({ folder: 'INBOX', from: 'stripe' }).data.map((m) => m.id)).toEqual([2]);
  expect(sync.read({ folder: 'INBOX', subject: 'invoice' }).data.map((m) => m.id)).toEqual([3, 1]);
  expect(sync.read({ folder: 'INBOX', since: '2026-01-03T00:00:00.000Z' }).data.map((m) => m.id)).toEqual([3]);
});

test('read applies the limit to matches, not to rows scanned', () => {
  seed([row(1, 'Invoice a'), row(2, 'Receipt'), row(3, 'Invoice b')]);
  const sync = buildSync(/** @type {any} */ ({}), store, { account: 'work', now });

  expect(sync.read({ folder: 'INBOX', subject: 'invoice', limit: 1 }).data.map((m) => m.id)).toEqual([3]);
});

// -- emails list --cached ------------------------------------------------------

test('emails list --cached serves the mirror and never touches the network', async () => {
  seed([row(1, 'from cache')]);
  const out = captureOutput();
  const client = clientWith({ live: [row(9, 'from server')] });
  try {
    await listEmailsHandler({ folder: 'INBOX', limit: 50, cached: true }, client);
  } finally {
    out.restore();
  }

  expect(out.stdout).toMatch(/from cache/);
  expect(out.stdout).not.toMatch(/from server/);
  expect(client.calls.live).toBe(0);
  expect(client.calls.closed).toBe(1);
});

test('emails list without --cached still goes live (default unchanged)', async () => {
  seed([row(1, 'from cache')]);
  const out = captureOutput();
  const client = clientWith({ live: [row(9, 'from server')] });
  try {
    await listEmailsHandler({ folder: 'INBOX', limit: 50 }, client);
  } finally {
    out.restore();
  }

  expect(out.stdout).toMatch(/from server/);
  expect(client.calls.live).toBe(1);
});

test('emails list --cached reports staleness on stderr, keeping stdout clean', async () => {
  seed([row(1, 'a')]);
  const out = captureOutput();
  try {
    await listEmailsHandler({ folder: 'INBOX', limit: 50, cached: true }, clientWith());
  } finally {
    out.restore();
  }

  expect(out.stderr).toMatch(/cached — synced/);
  expect(out.stdout).not.toMatch(/cached/);
});

test('emails list --cached --json emits data only, no staleness note', async () => {
  seed([row(1, 'a')]);
  const out = captureOutput();
  try {
    await listEmailsHandler({ folder: 'INBOX', limit: 50, cached: true, json: true }, clientWith());
  } finally {
    out.restore();
  }

  expect(out.stderr).toBe('');
  expect(JSON.parse(out.stdout)).toHaveLength(1);
});

test('emails list --cached errors instead of falling back to live', async () => {
  const client = clientWith({ live: [row(9, 'from server')] });
  await expect(
    listEmailsHandler({ folder: 'Archive', limit: 50, cached: true }, client),
  ).rejects.toThrow(/No local copy of "Archive"/);
  expect(client.calls.live).toBe(0);
});

// -- emails search --cached ----------------------------------------------------

test('emails search --cached filters locally', async () => {
  seed([row(1, 'Invoice'), row(2, 'Receipt')]);
  const out = captureOutput();
  const client = clientWith();
  try {
    await searchEmailsHandler({ folder: 'INBOX', subject: 'invoice', limit: 50, cached: true }, client);
  } finally {
    out.restore();
  }

  expect(out.stdout).toMatch(/Invoice/);
  expect(out.stdout).not.toMatch(/Receipt/);
  expect(client.calls.live).toBe(0);
});

test('emails search --cached refuses a body query rather than silently narrowing it', async () => {
  // The mirror stores envelopes, not bodies (S2). Quietly matching only the
  // subject would return a narrower result set than the user asked for.
  seed([row(1, 'Invoice')]);
  const client = clientWith();
  await expect(
    searchEmailsHandler({ folder: 'INBOX', query: 'refund', limit: 50, cached: true }, client),
  ).rejects.toThrow(/Full-text search needs the server/);
  expect(client.calls.live).toBe(0);
});

test('emails search --cached --since matches stored ISO dates', async () => {
  seed([row(1, 'old'), row(3, 'new')]);
  const out = captureOutput();
  try {
    await searchEmailsHandler(
      { folder: 'INBOX', since: '2026-01-03', limit: 50, cached: true },
      clientWith(),
    );
  } finally {
    out.restore();
  }

  expect(out.stdout).toMatch(/new/);
  expect(out.stdout).not.toMatch(/old/);
});
