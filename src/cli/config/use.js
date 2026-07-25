import { useAccount } from '../../config.js';

/** `fob-email config accounts use <name>` — set the current account. */
export function useConfigHandler(argv) {
  useAccount(argv.name);
  console.log(`Current account set to '${argv.name}'.`);
}
