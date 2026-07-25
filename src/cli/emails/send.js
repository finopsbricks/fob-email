// @ts-check
import { clientFor } from '../_helpers.js';
import { buildMessage } from './_message.js';

/**
 * `fob-email emails send --to <addr> --subject <s> ...` — one-shot SMTP send.
 * Uses the shared message-builder (D3).
 * @param {any} argv
 * @param {any} [mbox] injected client (tests); defaults to `clientFor(argv)`.
 */
export async function sendEmailHandler(argv, mbox) {
  const message = buildMessage(argv);

  const client = mbox ?? clientFor(argv);
  try {
    const result = await client.emails.send(message);
    if (argv.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    const to = Array.isArray(message.to) ? message.to.join(', ') : message.to;
    console.log(`Sent to ${to}${result?.messageId ? ` (${result.messageId})` : ''}.`);
    if (result?.rejected?.length) {
      console.error(`Rejected: ${result.rejected.join(', ')}`);
    }
  } finally {
    await client.close();
  }
}
