import { test, expect, beforeEach, afterEach } from '@jest/globals';

import { buildSync } from '../src/resources/sync.js';
import { openStore } from '../src/store/index.js';
import { syncRunHandler } from '../src/cli/sync/run.js';
import { syncStatusHandler } from '../src/cli/sync/status.js';
import { captureOutput } from './helpers.js';

/**
 * Phase 5 — multi-folder and multi-account sync.
 *
 * The rules under test are the two that lose work when broken:
 *   - folders sync **sequentially** (one IMAP connection has one selected
 *     mailbox — parallel SELECTs would read from the wrong folder);
 *   - one folder's failure must **not** abort the others.
 */

const envelope = (uid, subject, folder) => ({
  id: uid,
  messageId: `<${uid}-${folder}@x>`,
  from: { name: 'AWS', addr: 'billing@aws.com' },
  to: null,
  subject,
  date: `2026-01-0${uid}T00:00:00.000Z`,
  flags: [],
  hasAttachment: false,
  threadId: null,
  refs: [],
});

/**
 * A fake transport with several folders. `folders` maps path → message array;
 * `unselectable` paths are returned by LIST but reject SELECT, as Gmail's
 * "[Gmail]" container does.
 */
function fakeCtx({ folders = {}, unselectable = [], failOn = {} } = {}) {
  const order = [];
  /** Tracks whether two folders were ever being fetched at the same moment. */
  let inFlight = 0;
  let maxInFlight = 0;

  const guard = async (folder, fn) => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    try {
      // Yield to the event loop: if the caller ran folders concurrently, another
      // would enter here before this one leaves, and maxInFlight would exceed 1.
      await new Promise((r) => setImmediate(r));
      if (failOn[folder]) throw new Error(failOn[folder]);
      return fn();
    } finally {
      inFlight -= 1;
    }
  };

  return {
    order,
    get maxInFlight() {
      return maxInFlight;
    },
    listFolders: async () => [
      ...Object.keys(folders).map((path) => ({
        path,
        name: path,
        specialUse: null,
        subscribed: true,
        selectable: true,
      })),
      ...unselectable.map((path) => ({
        path,
        name: path,
        specialUse: null,
        subscribed: true,
        selectable: false,
      })),
    ],
    statusOf: async (folder) =>
      guard(folder, () => {
        order.push(folder);
        const msgs = folders[folder] ?? [];
        return {
          folder,
          uidValidity: 42,
          uidNext: msgs.reduce((m, x) => Math.max(m, x.id), 0) + 1,
          messages: msgs.length,
          highestModseq: null,
        };
      }),
    hasCondstore: async () => false,
    fetchForSync: async ({ folder, sinceUid = null }) =>
      guard(folder, () => {
        const msgs = (folders[folder] ?? []).filter((m) => (sinceUid ? m.id >= Number(sinceUid) : true));
        return {
          folder,
          uidValidity: 42,
          highestModseq: null,
          uids: msgs.map((m) => m.id),
          windowFrom: null,
          data: msgs,
        };
      }),
    fetchFlagChanges: async () => ({ supported: false, changes: [] }),
    listUids: async ({ folder }) => ({
      folder,
      uidValidity: 42,
      uids: (folders[folder] ?? []).map((m) => m.id),
    }),
    close: async () => {},
  };
}

/** @type {any} */
let store;
const now = () => '2026-08-10T12:00:00.000Z';
const mk = (ctx, account = 'work') => buildSync(ctx, store, { account, now });

beforeEach(() => {
  store = openStore({ path: ':memory:' });
});
afterEach(() => store?.close());

// -- runAll --------------------------------------------------------------------

test('runAll syncs every discovered folder', async () => {
  const ctx = fakeCtx({
    folders: {
      INBOX: [envelope(1, 'a', 'INBOX'), envelope(2, 'b', 'INBOX')],
      Archive: [envelope(1, 'c', 'Archive')],
    },
  });

  const res = await mk(ctx).runAll();

  expect(res.folders.map((f) => f.folder)).toEqual(['INBOX', 'Archive']);
  expect(res.fetched).toBe(3);
  expect(res.total).toBe(3);
  expect(res.failed).toEqual([]);
  expect(store.countMessages({ account: 'work', folder: 'Archive' })).toBe(1);
});

test('runAll syncs folders sequentially — one connection has one selected mailbox', async () => {
  const ctx = fakeCtx({
    folders: {
      INBOX: [envelope(1, 'a', 'INBOX')],
      Archive: [envelope(1, 'b', 'Archive')],
      Sent: [envelope(1, 'c', 'Sent')],
    },
  });

  await mk(ctx).runAll();

  // If runAll used Promise.all, two folders would overlap inside `guard`.
  expect(ctx.maxInFlight).toBe(1);
});

test('runAll skips \\Noselect containers rather than failing on them', async () => {
  const ctx = fakeCtx({
    folders: { INBOX: [envelope(1, 'a', 'INBOX')] },
    unselectable: ['[Gmail]'],
  });

  const res = await mk(ctx).runAll();

  expect(res.folders.map((f) => f.folder)).toEqual(['INBOX']);
  // Not merely "didn't crash" — it must not appear as a failure either, or a
  // server quirk would look like a problem the user should act on.
  expect(res.failed).toEqual([]);
});

test('one folder failing does not abort the rest', async () => {
  const ctx = fakeCtx({
    folders: {
      INBOX: [envelope(1, 'a', 'INBOX')],
      Broken: [envelope(1, 'b', 'Broken')],
      Sent: [envelope(1, 'c', 'Sent')],
    },
    failOn: { Broken: 'NO [NOPERM] permission denied' },
  });

  const res = await mk(ctx).runAll();

  expect(res.folders.map((f) => f.folder)).toEqual(['INBOX', 'Sent']);
  expect(res.failed).toEqual([{ folder: 'Broken', error: 'NO [NOPERM] permission denied' }]);
  expect(res.fetched).toBe(2);
  // The healthy folders really landed — a partial sync is still a sync.
  expect(store.countMessages({ account: 'work', folder: 'Sent' })).toBe(1);
});

test('runAll accepts an explicit folder list, skipping discovery', async () => {
  const ctx = fakeCtx({
    folders: { INBOX: [envelope(1, 'a', 'INBOX')], Archive: [envelope(1, 'b', 'Archive')] },
  });

  const res = await mk(ctx).runAll({ folders: ['Archive'] });

  expect(res.folders.map((f) => f.folder)).toEqual(['Archive']);
});

test('runAll passes --full through to every folder', async () => {
  const ctx = fakeCtx({ folders: { INBOX: [envelope(1, 'a', 'INBOX')], Archive: [] } });
  const sync = mk(ctx);
  await sync.runAll();

  const res = await sync.runAll({ full: true });
  expect(res.folders.every((f) => f.mode === 'full')).toBe(true);
});

// -- CLI: --all-folders --------------------------------------------------------

/** A client whose sync namespace is real, over the seeded store. */
function clientWith(ctx, account = 'work') {
  const calls = { closed: 0 };
  return {
    calls,
    sync: mk(ctx, account),
    close: async () => {
      calls.closed += 1;
    },
  };
}

test('sync run --all-folders lists each folder and a total', async () => {
  const ctx = fakeCtx({
    folders: { INBOX: [envelope(1, 'a', 'INBOX'), envelope(2, 'b', 'INBOX')], Archive: [envelope(1, 'c', 'Archive')] },
  });
  const client = clientWith(ctx);
  const out = captureOutput();
  try {
    await syncRunHandler({ allFolders: true }, client);
  } finally {
    out.restore();
  }

  expect(out.stdout).toMatch(/INBOX — 2 new/);
  expect(out.stdout).toMatch(/Archive — 1 new/);
  expect(out.stdout).toMatch(/3 new, 3 mirrored/);
  expect(client.calls.closed).toBe(1);
});

test('sync run --all-folders reports failures on stderr and exits non-zero', async () => {
  const prev = process.exitCode;
  const ctx = fakeCtx({
    folders: { INBOX: [envelope(1, 'a', 'INBOX')], Broken: [] },
    failOn: { Broken: 'permission denied' },
  });
  const out = captureOutput();
  try {
    await syncRunHandler({ allFolders: true }, clientWith(ctx));
  } finally {
    out.restore();
  }

  // stdout stays clean for a pipe; the failure goes to stderr.
  expect(out.stdout).toMatch(/INBOX — 1 new/);
  expect(out.stdout).not.toMatch(/permission denied/);
  expect(out.stderr).toMatch(/1 folder\(s\) failed/);
  expect(out.stderr).toMatch(/Broken: permission denied/);
  expect(process.exitCode).toBe(1);
  process.exitCode = prev;
});

test('single-folder --json keeps its flat shape (scripts must not break)', async () => {
  const ctx = fakeCtx({ folders: { INBOX: [envelope(1, 'a', 'INBOX')] } });
  const out = captureOutput();
  try {
    await syncRunHandler({ folder: 'INBOX', json: true }, clientWith(ctx));
  } finally {
    out.restore();
  }

  const parsed = JSON.parse(out.stdout);
  expect(Array.isArray(parsed)).toBe(false);
  expect(parsed.folder).toBe('INBOX');
  expect(parsed.mode).toBe('full');
});

test('--all-folders --json nests, since one object could not carry many folders', async () => {
  const ctx = fakeCtx({ folders: { INBOX: [envelope(1, 'a', 'INBOX')], Archive: [] } });
  const out = captureOutput();
  try {
    await syncRunHandler({ allFolders: true, json: true }, clientWith(ctx));
  } finally {
    out.restore();
  }

  const parsed = JSON.parse(out.stdout);
  expect(Array.isArray(parsed)).toBe(true);
  expect(parsed[0].folders.map((f) => f.folder)).toEqual(['INBOX', 'Archive']);
});

// -- CLI: --all-accounts -------------------------------------------------------

test('sync run --all-accounts syncs each account and labels the output', async () => {
  const built = [];
  const factory = (account) => {
    const ctx = fakeCtx({ folders: { INBOX: [envelope(1, `mail-${account}`, 'INBOX')] } });
    built.push(account);
    return clientWith(ctx, account);
  };

  const out = captureOutput();
  try {
    await syncRunHandler({ folder: 'INBOX', allAccounts: true, _accounts: ['work', 'personal'] }, factory);
  } finally {
    out.restore();
  }

  expect(built).toEqual(['work', 'personal']);
  expect(out.stdout).toMatch(/work:/);
  expect(out.stdout).toMatch(/personal:/);
  expect(store.countMessages({ account: 'personal', folder: 'INBOX' })).toBe(1);
});

test('sync status --all-accounts adds an account column', async () => {
  const ctx = fakeCtx({ folders: { INBOX: [envelope(1, 'a', 'INBOX')] } });
  await mk(ctx, 'work').run({ folder: 'INBOX' });
  await mk(ctx, 'personal').run({ folder: 'INBOX' });

  const out = captureOutput();
  try {
    await syncStatusHandler({ allAccounts: true, _accounts: ['work', 'personal'] }, (a) => clientWith(ctx, a));
  } finally {
    out.restore();
  }

  expect(out.stdout).toMatch(/ACCOUNT/);
  expect(out.stdout).toMatch(/work/);
  expect(out.stdout).toMatch(/personal/);
});

test('sync status without --all-accounts omits the account column', async () => {
  const ctx = fakeCtx({ folders: { INBOX: [envelope(1, 'a', 'INBOX')] } });
  await mk(ctx, 'work').run({ folder: 'INBOX' });

  const out = captureOutput();
  try {
    await syncStatusHandler({ account: 'work' }, clientWith(ctx, 'work'));
  } finally {
    out.restore();
  }

  expect(out.stdout).not.toMatch(/ACCOUNT/);
  expect(out.stdout).toMatch(/INBOX/);
});
