import { connectSession } from './engine/imap.js';
import { createTransport } from './engine/transport.js';
import { buildEmails } from './resources/emails.js';
import { buildFolders } from './resources/folders.js';

export { connectSession };
export { filterEmails } from './domain/filter.js';
export { resolveAccount } from './config.js';

/**
 * The importable email client — the fob-stm `fobStm(creds)` analog for a
 * protocol tool. Binds one account's credentials into resource namespaces over a
 * lazily-connected transport. The CLI builds the same client (see
 * `src/cli/_helpers.js` `clientFor`) and calls these same namespaces, so the CLI
 * and the library can never drift — every op is defined once, in src/resources/.
 *
 * Connections are lazy; the caller must `close()` (or use the one-shot helpers).
 *
 *   import { fobEmail } from '@fob/email';
 *   const mbox = fobEmail('work');
 *   try { const { data } = await mbox.emails.list({ unseen: true }); }
 *   finally { await mbox.close(); }
 *
 * @param {string|object} [account] account name, or a raw config object.
 */
export function fobEmail(account) {
  const ctx = createTransport(account);
  return {
    emails: buildEmails(ctx),
    folders: buildFolders(ctx),
    /** Tear down whichever connections were opened. */
    close: () => ctx.close(),
  };
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
