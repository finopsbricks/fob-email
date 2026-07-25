import { getIdentity } from '../../index.js';
import { setAccountIdentity } from '../../config.js';

/**
 * Best-effort: connect, resolve the account's mailbox address, and cache it as
 * non-secret metadata. Never throws — a failed/blocked connection must not stop
 * the caller (decision G: adding creds must not require a network round-trip).
 * Returns the identity on success, else null.
 */
export async function refreshIdentity(name) {
  try {
    const id = await getIdentity(name);
    if (id?.address) {
      setAccountIdentity(name, { address: id.address });
      return id;
    }
  } catch (err) {
    console.error(`(could not verify '${name}': ${err.message})`);
  }
  return null;
}
