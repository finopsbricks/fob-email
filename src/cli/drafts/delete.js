// @ts-check
import { clientFor } from '../_helpers.js';

/**
 * `fob-email drafts delete <id> --yes` — delete a draft. Refuses without `--yes`.
 * @param {any} argv
 * @param {any} [mbox] injected client (tests); defaults to `clientFor(argv)`.
 */
export async function deleteDraftHandler(argv, mbox) {
  if (!argv.yes) {
    throw new Error(`Refusing to delete draft #${argv.id} without --yes.`);
  }

  const client = mbox ?? clientFor(argv);
  try {
    const result = await client.drafts.delete(Number(argv.id));
    if (argv.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    console.log(`Deleted draft #${argv.id}.`);
  } finally {
    await client.close();
  }
}
