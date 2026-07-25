// @ts-check
import { clientFor } from '../_helpers.js';

/**
 * `fob-email emails move <id> --to <folder>` — move a message to another folder.
 * @param {any} argv
 * @param {any} [mbox] injected client (tests); defaults to `clientFor(argv)`.
 */
export async function moveEmailHandler(argv, mbox) {
  if (!argv.to) throw new Error('--to <folder> is required.');

  const client = mbox ?? clientFor(argv);
  try {
    const result = await client.emails.move(Number(argv.id), argv.to, { folder: argv.folder });
    if (argv.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    console.log(`Moved #${argv.id} from ${argv.folder} to ${argv.to}.`);
  } finally {
    await client.close();
  }
}
