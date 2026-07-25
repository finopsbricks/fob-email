// @ts-check
import { clientFor } from '../_helpers.js';

/**
 * `fob-email folders create <name>` — create a folder (e.g. "Invoices/2026").
 * @param {any} argv
 * @param {any} [mbox] injected client (tests); defaults to `clientFor(argv)`.
 */
export async function createFolderHandler(argv, mbox) {
  const client = mbox ?? clientFor(argv);
  try {
    const result = await client.folders.create(argv.name);
    if (argv.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    console.log(`Created folder ${argv.name}.`);
  } finally {
    await client.close();
  }
}
