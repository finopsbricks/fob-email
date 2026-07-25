// @ts-check
import { clientFor } from '../_helpers.js';
import { emitEnvelopes } from './_envelopes.js';

/**
 * `fob-email emails list` — envelopes for a folder, newest first. Human table by
 * default; `--json` emits the raw envelope array (for scripting / the `filter` pipe).
 * @param {any} argv
 * @param {any} [mbox] injected client (tests); defaults to `clientFor(argv)`.
 */
export async function listEmailsHandler(argv, mbox) {
  const client = mbox ?? clientFor(argv);
  try {
    const { data } = await client.emails.list({
      folder: argv.folder,
      unseenOnly: argv.unseen,
      limit: argv.limit,
    });
    emitEnvelopes(data, argv);
  } finally {
    await client.close();
  }
}
