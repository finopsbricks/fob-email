import { filterEmails } from '../index.js';
import { emitJson, readStdin } from './_helpers.js';

/**
 * `fob-email filter` — pure, no connection. Reads an envelopes JSON array from
 * stdin (typically piped from `fob-email list`) and filters it.
 */
export async function filterHandler(argv) {
  const envelopes = JSON.parse(await readStdin());
  emitJson(
    filterEmails(envelopes, {
      from: argv.from,
      to: argv.to,
      subject: argv.subject,
      hasAttachment: argv['has-attachment'] ? true : undefined,
      seen: argv.seen ? true : argv.unseen ? false : undefined,
    }),
  );
}
