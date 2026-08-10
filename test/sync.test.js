import { test, expect, beforeEach, afterEach } from '@jest/globals';

import { buildSync } from '../src/resources/sync.js';
import { openStore } from '../src/store/index.js';
import { syncRunHandler } from '../src/cli/sync/run.js';
import { syncStatusHandler } from '../src/cli/sync/status.js';
import { syncClearHandler } from '../src/cli/sync/clear.js';
import { relativeAge } from '../src/cli/sync/status.js';
import { captureOutput } from './helpers.js';

/**
 * Phase 2 — `sync run` against a fake server.
 *
 * The two failure modes worth the most attention, because both delete mail from
 * the mirror when they go wrong:
 *   - an incremental pass must NOT treat older rows as vanished (that would
 *     empty the mirror on every sync);
 *   - a UIDVALIDITY roll MUST purge, or stale ids get reinterpreted (D4).
 */

const envelope = (uid, subject, date, extra = {}) => ({
  id: uid,
  messageId: `<${uid}@example.com>`,
  from: { name: 'AWS', addr: 'billing@aws.com' },
  to: null,
  subject,
  date,
  flags: [],
  hasAttachment: false,
  threadId: null,
  refs: [],
  ...extra,
});

/**
 * A fake transport. `mailbox` is the server's truth; each call recomputes from
 * it, so a test can mutate the mailbox between syncs the way a real server would.
 */
function fakeCtx({ messages = [], uidValidity = 42, uidNext = null } = {}) {
  const state = { messages: [...messages], uidValidity, uidNext };
  const calls = { statusOf: [], fetchForSync: [] };

  return {
    state,
    calls,
    statusOf: async (folder = 'INBOX') => {
      calls.statusOf.push(folder);
      const maxUid = state.messages.reduce((m, x) => Math.max(m, x.id), 0);
      return {
        folder,
        uidValidity: state.uidValidity,
        uidNext: state.uidNext ?? maxUid + 1,
        messages: state.messages.length,
        highestModseq: null,
      };
    },
    fetchForSync: async ({ folder = 'INBOX', sinceUid = null, limit = null } = {}) => {
      calls.fetchForSync.push({ folder, sinceUid, limit });
      let picked = state.messages.filter((m) => (sinceUid ? m.id >= Number(sinceUid) : true));
      let windowFrom = null;
      if (limit && !sinceUid && picked.length > limit) {
        picked = picked.slice(-limit);
        windowFrom = picked[0].id;
      }
      return {
        folder,
        uidValidity: state.uidValidity,
        uids: picked.map((m) => m.id),
        windowFrom,
        data: picked,
      };
    },
    close: async () => {},
  };
}

const at = (n) => `2026-01-${String(n).padStart(2, '0')}T00:00:00.000Z`;

/** @type {any} */
let store;
const now = () => '2026-08-10T12:00:00.000Z';
const mk = (ctx) => buildSync(ctx, store, { account: 'work', now });

beforeEach(() => {
  store = openStore({ path: ':memory:' });
});
afterEach(() => store?.close());

// -- first sync ----------------------------------------------------------------

test('a first sync mirrors the folder and reports mode=full', async () => {
  const ctx = fakeCtx({ messages: [envelope(1, 'a', at(1)), envelope(2, 'b', at(2))] });
  const res = await mk(ctx).run({ folder: 'INBOX' });

  expect(res.mode).toBe('full');
  expect(res.fetched).toBe(2);
  expect(res.total).toBe(2);
  expect(store.listMessages({ account: 'work', folder: 'INBOX' }).map((m) => m.subject)).toEqual(['b', 'a']);
});

test('a first sync stores the cursor so the next pass is incremental', async () => {
  const ctx = fakeCtx({ messages: [envelope(1, 'a', at(1))] });
  const sync = mk(ctx);
  await sync.run({ folder: 'INBOX' });

  const res = await sync.run({ folder: 'INBOX' });
  expect(res.mode).toBe('incremental');
  expect(ctx.calls.fetchForSync[1].sinceUid).toBe(2); // uidNext after uid 1
});

test('--limit caps a first sync to the newest N', async () => {
  const ctx = fakeCtx({ messages: [1, 2, 3, 4, 5].map((u) => envelope(u, `s${u}`, at(u))) });
  const res = await mk(ctx).run({ folder: 'INBOX', limit: 2 });

  expect(res.fetched).toBe(2);
  expect(store.listMessages({ account: 'work', folder: 'INBOX' }).map((m) => m.subject)).toEqual(['s5', 's4']);
});

// -- incremental ---------------------------------------------------------------

test('an incremental sync adds new mail and keeps existing rows', async () => {
  const ctx = fakeCtx({ messages: [envelope(1, 'a', at(1))] });
  const sync = mk(ctx);
  await sync.run({ folder: 'INBOX' });

  ctx.state.messages.push(envelope(2, 'b', at(2)));
  const res = await sync.run({ folder: 'INBOX' });

  expect(res.mode).toBe('incremental');
  expect(res.fetched).toBe(1);
  expect(res.total).toBe(2);
});

test('an incremental sync does NOT delete older mirrored rows', async () => {
  // The regression that would empty the mirror: older uids are outside the
  // searched window, so they are not evidence of deletion.
  const ctx = fakeCtx({ messages: [1, 2, 3].map((u) => envelope(u, `s${u}`, at(u))) });
  const sync = mk(ctx);
  await sync.run({ folder: 'INBOX' });

  const res = await sync.run({ folder: 'INBOX' }); // nothing new server-side
  expect(res.vanished).toBe(0);
  expect(res.total).toBe(3);
});

test('a no-op incremental sync fetches nothing despite the uid N:* range', async () => {
  // `uid N:*` always matches the highest existing uid even when none are >= N,
  // so a naive implementation re-fetches one message on every poll.
  const ctx = fakeCtx({ messages: [envelope(1, 'a', at(1))] });
  const sync = mk(ctx);
  await sync.run({ folder: 'INBOX' });

  const res = await sync.run({ folder: 'INBOX' });
  expect(res.fetched).toBe(0);
  expect(res.total).toBe(1);
});

// -- vanished ------------------------------------------------------------------

test('a full sync removes messages deleted server-side', async () => {
  const ctx = fakeCtx({ messages: [1, 2, 3].map((u) => envelope(u, `s${u}`, at(u))) });
  const sync = mk(ctx);
  await sync.run({ folder: 'INBOX' });

  ctx.state.messages = ctx.state.messages.filter((m) => m.id !== 2);
  const res = await sync.run({ folder: 'INBOX', full: true });

  expect(res.total).toBe(2);
  expect(store.listMessages({ account: 'work', folder: 'INBOX' }).map((m) => m.id)).toEqual([3, 1]);
});

// -- UIDVALIDITY (D4) ----------------------------------------------------------

test('a UIDVALIDITY change purges and reports mode=reset', async () => {
  const ctx = fakeCtx({ messages: [1, 2].map((u) => envelope(u, `old-${u}`, at(u))) });
  const sync = mk(ctx);
  await sync.run({ folder: 'INBOX' });

  // The folder was recreated server-side: same uids, entirely different mail.
  ctx.state.uidValidity = 43;
  ctx.state.messages = [envelope(1, 'fresh', at(9))];
  const res = await sync.run({ folder: 'INBOX' });

  expect(res.mode).toBe('reset');
  expect(res.total).toBe(1);
  expect(store.listMessages({ account: 'work', folder: 'INBOX' })[0].subject).toBe('fresh');
  expect(store.getFolder({ account: 'work', folder: 'INBOX' }).uidValidity).toBe(43);
});

// -- isolation -----------------------------------------------------------------

test('folders and accounts keep separate mirrors', async () => {
  const ctx = fakeCtx({ messages: [envelope(1, 'inbox', at(1))] });
  await mk(ctx).run({ folder: 'INBOX' });

  const other = fakeCtx({ messages: [envelope(1, 'archived', at(1))] });
  await mk(other).run({ folder: 'Archive' });

  const personal = buildSync(fakeCtx({ messages: [envelope(1, 'mine', at(1))] }), store, {
    account: 'personal',
    now,
  });
  await personal.run({ folder: 'INBOX' });

  expect((await mk(ctx).status()).map((r) => r.folder).sort()).toEqual(['Archive', 'INBOX']);
  expect((await personal.status()).map((r) => r.folder)).toEqual(['INBOX']);
});

// -- status / clear ------------------------------------------------------------

test('status reports counts and the sync time', async () => {
  const ctx = fakeCtx({ messages: [envelope(1, 'a', at(1))] });
  const sync = mk(ctx);
  await sync.run({ folder: 'INBOX' });

  expect(await sync.status()).toEqual([
    expect.objectContaining({ folder: 'INBOX', messages: 1, lastSyncedAt: now(), uidValidity: 42 }),
  ]);
});

test('clear drops the mirror and reports how much went', async () => {
  const ctx = fakeCtx({ messages: [1, 2].map((u) => envelope(u, `s${u}`, at(u))) });
  const sync = mk(ctx);
  await sync.run({ folder: 'INBOX' });

  expect(await sync.clear({ folder: 'INBOX' })).toEqual({ account: 'work', folder: 'INBOX', cleared: 2 });
  expect(await sync.status()).toEqual([]);
});

// -- CLI handlers --------------------------------------------------------------

/** A fake client exposing just the sync namespace the handlers use. */
function fakeSyncClient(canned = {}) {
  const calls = { run: [], status: [], clear: [], closed: 0 };
  return {
    calls,
    sync: {
      run: async (o) => (calls.run.push(o), canned.run ?? { account: 'work', folder: 'INBOX', mode: 'full', fetched: 2, vanished: 0, total: 2 }),
      status: async (o) => (calls.status.push(o), canned.status ?? []),
      clear: async (o) => (calls.clear.push(o), canned.clear ?? { account: 'work', folder: null, cleared: 5 }),
    },
    close: async () => { calls.closed += 1; },
  };
}

test('sync run prints a summary and closes the client', async () => {
  const out = captureOutput();
  const client = fakeSyncClient();
  try {
    await syncRunHandler({ folder: 'INBOX' }, client);
  } finally {
    out.restore();
  }
  expect(out.stdout).toMatch(/INBOX/);
  expect(out.stdout).toMatch(/full/);
  expect(client.calls.closed).toBe(1);
});

test('sync run warns on stderr when the folder was reset', async () => {
  const out = captureOutput();
  const client = fakeSyncClient({
    run: { account: 'work', folder: 'INBOX', mode: 'reset', fetched: 1, vanished: 0, total: 1 },
  });
  try {
    await syncRunHandler({ folder: 'INBOX' }, client);
  } finally {
    out.restore();
  }
  expect(out.stderr).toMatch(/UIDVALIDITY changed/);
});

test('sync run --json emits the raw result', async () => {
  const out = captureOutput();
  try {
    await syncRunHandler({ folder: 'INBOX', json: true }, fakeSyncClient());
  } finally {
    out.restore();
  }
  expect(JSON.parse(out.stdout)).toMatchObject({ folder: 'INBOX', mode: 'full' });
});

test('sync status says so when nothing is mirrored', async () => {
  const out = captureOutput();
  try {
    await syncStatusHandler({}, fakeSyncClient({ status: [] }));
  } finally {
    out.restore();
  }
  expect(out.stdout).toMatch(/nothing synced yet/);
});

test('sync status renders a table with relative age', async () => {
  const out = captureOutput();
  const client = fakeSyncClient({
    status: [{ account: 'work', folder: 'INBOX', messages: 12, lastSyncedAt: new Date(Date.now() - 5 * 60000).toISOString() }],
  });
  try {
    await syncStatusHandler({}, client);
  } finally {
    out.restore();
  }
  expect(out.stdout).toMatch(/FOLDER\s+MESSAGES\s+LAST SYNCED/);
  expect(out.stdout).toMatch(/5m ago/);
});

test('sync clear refuses without --yes and does not call the client', async () => {
  const client = fakeSyncClient();
  await expect(syncClearHandler({}, client)).rejects.toThrow(/without --yes/);
  expect(client.calls.clear).toHaveLength(0);
});

test('sync clear says the mail itself is untouched', async () => {
  const client = fakeSyncClient();
  await expect(syncClearHandler({}, client)).rejects.toThrow(/only local data/);
});

test('sync clear with --yes clears and reports', async () => {
  const out = captureOutput();
  const client = fakeSyncClient();
  try {
    await syncClearHandler({ yes: true }, client);
  } finally {
    out.restore();
  }
  expect(out.stdout).toMatch(/Cleared 5 mirrored message\(s\)/);
  expect(client.calls.closed).toBe(1);
});

// -- relative age --------------------------------------------------------------

test('relativeAge renders coarse buckets', () => {
  const now = new Date('2026-08-10T12:00:00.000Z').getTime();
  expect(relativeAge(null, now)).toBe('never');
  expect(relativeAge('2026-08-10T11:59:40.000Z', now)).toBe('just now');
  expect(relativeAge('2026-08-10T11:30:00.000Z', now)).toBe('30m ago');
  expect(relativeAge('2026-08-10T09:00:00.000Z', now)).toBe('3h ago');
  expect(relativeAge('2026-08-07T12:00:00.000Z', now)).toBe('3d ago');
});
