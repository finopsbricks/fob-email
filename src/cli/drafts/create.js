// @ts-check
import { clientFor } from '../_helpers.js';
import { buildMessage } from '../emails/_message.js';

/**
 * `fob-email drafts create --to ... --subject ...` — save a new draft. Uses the
 * shared D3 message-builder.
 * @param {any} argv
 * @param {any} [mbox] injected client (tests); defaults to `clientFor(argv)`.
 */
export async function createDraftHandler(argv, mbox) {
  const message = buildMessage(argv);

  const client = mbox ?? clientFor(argv);
  try {
    const ref = await client.drafts.create(message);
    if (argv.json) {
      console.log(JSON.stringify(ref, null, 2));
      return;
    }
    console.log(`Saved draft${ref?.id != null ? ` #${ref.id}` : ''} to ${ref?.folder ?? 'Drafts'}.`);
  } finally {
    await client.close();
  }
}
