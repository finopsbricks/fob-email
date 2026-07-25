import { accountNames } from '../../config.js';
import { refreshIdentity } from './_identity.js';

/**
 * `fob-email config accounts refresh [name] --all` — re-resolve the cached
 * mailbox address(es) from the server by connecting. The server is the source
 * of truth; this fixes drift.
 */
export async function refreshConfigHandler(argv) {
  let names;
  if (argv.all) names = accountNames();
  else if (argv.name) names = [argv.name];
  else throw new Error('Specify an account name, or --all.');

  if (names.length === 0) {
    console.log('(no accounts configured)');
    return;
  }

  for (const name of names) {
    const id = await refreshIdentity(name);
    console.log(id?.address ? `${name}: ${id.address}` : `${name}: (unresolved)`);
  }
}
