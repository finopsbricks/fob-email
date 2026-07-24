import { Session } from './engine/imap.js';

export { Session };
export { filterEmails } from './domain/filter.js';
export { resolveAccount } from './config.js';

/** Connect and return a Session. Caller closes. Primary API for batching. */
export async function connect(account) {
  return Session.connect(account);
}

/** One-shot list: connect → list → close. */
export async function listEmails({ account, ...opts } = {}) {
  const s = await connect(account);
  try {
    return await s.list(opts);
  } finally {
    await s.close();
  }
}

/** One-shot read: connect → read → close. */
export async function readEmail({ account, ...opts } = {}) {
  const s = await connect(account);
  try {
    return await s.read(opts);
  } finally {
    await s.close();
  }
}
