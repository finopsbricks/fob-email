// @ts-check
import { clientFor } from '../_helpers.js';

/**
 * `fob-email drafts send <id>` — send a saved draft via SMTP, then remove it
 * from the Drafts folder.
 * @param {any} argv
 * @param {any} [mbox] injected client (tests); defaults to `clientFor(argv)`.
 */
export async function sendDraftHandler(argv, mbox) {
  const client = mbox ?? clientFor(argv);
  try {
    const result = await client.drafts.send(Number(argv.id));
    if (argv.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    const to = (result?.accepted ?? []).join(', ');
    console.log(`Sent draft #${argv.id}${to ? ` to ${to}` : ''}${result?.messageId ? ` (${result.messageId})` : ''}.`);
    if (result?.rejected?.length) console.error(`Rejected: ${result.rejected.join(', ')}`);
  } finally {
    await client.close();
  }
}
