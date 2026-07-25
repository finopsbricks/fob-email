// @ts-check
import { clientFor } from '../_helpers.js';

/**
 * `fob-email folders rename <name> --to <new-name>` — rename/move a folder.
 * @param {any} argv
 * @param {any} [mbox] injected client (tests); defaults to `clientFor(argv)`.
 */
export async function renameFolderHandler(argv, mbox) {
  if (!argv.to) throw new Error('--to <new-name> is required.');

  const client = mbox ?? clientFor(argv);
  try {
    const result = await client.folders.rename(argv.name, argv.to);
    if (argv.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    console.log(`Renamed folder ${argv.name} → ${argv.to}.`);
  } finally {
    await client.close();
  }
}
