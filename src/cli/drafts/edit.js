// @ts-check
import { clientFor } from '../_helpers.js';
import { buildMessage } from '../emails/_message.js';

/**
 * `fob-email drafts edit <id> --to ... --subject ...` — replace a draft. IMAP
 * messages are immutable, so this appends a new draft and deletes the old one;
 * the new draft gets a new id. `edit` replaces wholesale (not a field patch).
 * @param {any} argv
 * @param {any} [mbox] injected client (tests); defaults to `clientFor(argv)`.
 */
export async function editDraftHandler(argv, mbox) {
  const message = buildMessage(argv);

  const client = mbox ?? clientFor(argv);
  try {
    const ref = await client.drafts.edit(Number(argv.id), message);
    if (argv.json) {
      console.log(JSON.stringify(ref, null, 2));
      return;
    }
    console.log(`Replaced draft #${argv.id}${ref?.id != null ? ` → #${ref.id}` : ''}.`);
  } finally {
    await client.close();
  }
}
