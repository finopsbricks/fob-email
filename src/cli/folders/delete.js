// @ts-check
import { clientFor } from '../_helpers.js';

/**
 * `fob-email folders delete <name> --yes` — delete a folder. Refuses without
 * `--yes` (destructive, no interactive prompt).
 * @param {any} argv
 * @param {any} [mbox] injected client (tests); defaults to `clientFor(argv)`.
 */
export async function deleteFolderHandler(argv, mbox) {
  if (!argv.yes) {
    throw new Error(`Refusing to delete folder ${argv.name} without --yes.`);
  }

  const client = mbox ?? clientFor(argv);
  try {
    const result = await client.folders.delete(argv.name);
    if (argv.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    console.log(`Deleted folder ${argv.name}.`);
  } finally {
    await client.close();
  }
}
