// @ts-check
import { clientFor } from '../_helpers.js';

/**
 * `fob-email emails delete <id> --yes` — permanently delete a message. Refuses
 * without `--yes` (no interactive prompt in a scriptable CLI).
 * @param {any} argv
 * @param {any} [mbox] injected client (tests); defaults to `clientFor(argv)`.
 */
export async function deleteEmailHandler(argv, mbox) {
  if (!argv.yes) {
    throw new Error(`Refusing to delete #${argv.id} without --yes.`);
  }

  const client = mbox ?? clientFor(argv);
  try {
    const result = await client.emails.delete(Number(argv.id), { folder: argv.folder });
    if (argv.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    console.log(`Deleted #${argv.id} from ${argv.folder}.`);
  } finally {
    await client.close();
  }
}
