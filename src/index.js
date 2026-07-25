import { Session } from './engine/imap.js';

export { Session };
export { filterEmails } from './domain/filter.js';
export { resolveAccount } from './config.js';

/** Connect and return a Session. Caller closes. Primary API for batching. */
export async function connect(account) {
  return Session.connect(account);
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
