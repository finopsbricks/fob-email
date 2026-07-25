import { getProfile } from '../../index.js';
import { setAccountProfile } from '../../config.js';

/**
 * Best-effort (D6): connect, probe the account's self-describing profile
 * (address + provider + thread strategy), and cache it as non-secret metadata.
 * Never throws — a failed/blocked connection must not stop the caller (adding
 * creds must not require a network round-trip). Returns the profile, else null.
 */
export async function refreshProfile(name) {
  try {
    const profile = await getProfile(name);
    if (profile?.address) {
      setAccountProfile(name, profile);
      return profile;
    }
  } catch (err) {
    console.error(`(could not verify '${name}': ${err.message})`);
  }
  return null;
}
