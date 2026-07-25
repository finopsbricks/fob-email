import { accountNames } from '../../config.js';
import { refreshProfile } from './_identity.js';

/**
 * `fob-email config accounts refresh [name] --all` — re-probe the cached profile
 * (address + provider + thread strategy) from the server by connecting (D6). The
 * server is the source of truth; this fixes drift.
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
    const p = await refreshProfile(name);
    console.log(
      p?.address ? `${name}: ${p.address} (${p.provider}, threads: ${p.threadStrategy})` : `${name}: (unresolved)`,
    );
  }
}
