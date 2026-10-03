import { connectSession } from './engine/imap.js';
import { createTransport } from './engine/transport.js';
import { buildEmails } from './resources/emails.js';
import { buildFolders } from './resources/folders.js';
import { buildThreads } from './resources/threads.js';
import { buildDrafts } from './resources/drafts.js';
import { buildSync } from './resources/sync.js';
import { openStore } from './store/index.js';

export { connectSession };
export { openStore, isAvailable as syncAvailable } from './store/index.js';
export { filterEmails } from './domain/filter.js';
export { resolveAccount } from './config.js';

/**
 * The importable email client. Binds one account's credentials into resource namespaces over a
 * lazily-connected transport. The CLI builds the same client (see
 * `src/cli/_helpers.js` `clientFor`) and calls these same namespaces, so the CLI
 * and the library can never drift — every op is defined once, in src/resources/.
 *
 * Connections are lazy; the caller must `close()` (or use the one-shot helpers).
 *
 *   import { fobEmail } from '@finopsbricks/fob-email';
 *   const mbox = fobEmail('work');
 *   try { const { data } = await mbox.emails.list({ unseen: true }); }
 *   finally { await mbox.close(); }
 *
 * @param {string|object} [account] account name, or a raw config object.
 */
export function fobEmail(account, { storePath } = {}) {
  const ctx = createTransport(account);

  // The store opens on first use, like the connections — a client that never
  // syncs never touches SQLite, so the live paths keep working on a runtime
  // without it (and `close()` has nothing to tear down).
  /** @type {any} */
  let store = null;
  const storeFor = () => (store ??= openStore(storePath ? { path: storePath } : undefined));

  return {
    emails: buildEmails(ctx),
    threads: buildThreads(ctx),
    drafts: buildDrafts(ctx),
    folders: buildFolders(ctx),

    /**
     * The local mirror (D7/D8). A getter so `openStore()` is deferred until a
     * sync verb is actually called.
     */
    get sync() {
      return buildSync(ctx, storeFor(), { account: accountKey(account) });
    },

    /** Tear down whichever connections were opened. */
    close: async () => {
      await ctx.close();
      if (store) store.close();
    },
  };
}

/**
 * The name a mirror's rows are filed under. A raw config object has no name, so
 * it is keyed by its login address — two different mailboxes must never share
 * mirror rows.
 * @param {string|object} [account]
 */
function accountKey(account) {
  if (!account) return 'default';
  if (typeof account === 'string') return account;
  return account?.imap?.user ?? 'default';
}

/** Connect and return a live session. Caller closes. Primary API for batching. */
export async function connect(account) {
  return connectSession(account);
}

/** One-shot list: connect → list → close. Returns the envelope array. */
export async function listEmails({ account, ...opts } = {}) {
  const s = await connect(account);
  try {
    return (await s.list(opts)).data;
  } finally {
    await s.close();
  }
}

/** One-shot read: connect → read → close. */
export async function readEmail({ account, ...opts } = {}) {
  const s = await connect(account);
  try {
    return await s.fetchFull(opts);
  } finally {
    await s.close();
  }
}

/**
 * Resolve the authenticated mailbox identity for an account: connect, read the
 * identity, close. `{ address }`, validated by a successful login. Exposed on
 * the client so workers can self-identify too (CLI standard, decision G).
 */
export async function getIdentity(account) {
  const s = await connect(account);
  try {
    return s.identity();
  } finally {
    await s.close();
  }
}

/**
 * Probe an account's self-describing profile (D6): connect, read the server
 * capabilities, close. `{ address, provider, threadStrategy }`. Cached by the CLI
 * on `config accounts add`/`refresh`; exposed here so workers can probe too.
 */
export async function getProfile(account) {
  const s = await connect(account);
  try {
    return s.probe();
  } finally {
    await s.close();
  }
}
