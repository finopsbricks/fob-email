// @ts-check
import { clientFor } from '../_helpers.js';
import { emitEnvelopes } from '../emails/_envelopes.js';

/**
 * `fob-email drafts list` — envelopes in the Drafts folder.
 * @param {any} argv
 * @param {any} [mbox] injected client (tests); defaults to `clientFor(argv)`.
 */
export async function listDraftsHandler(argv, mbox) {
  const client = mbox ?? clientFor(argv);
  try {
    const { data } = await client.drafts.list();
    emitEnvelopes(data, argv);
  } finally {
    await client.close();
  }
}
