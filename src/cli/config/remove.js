import { removeAccount } from '../../config.js';

/** `fob-email config accounts remove <name>` (alias: rm). */
export function removeConfigHandler(argv) {
  removeAccount(argv.name);
  console.log(`Removed account '${argv.name}'.`);
}
