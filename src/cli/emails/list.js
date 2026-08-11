// @ts-check
import { clientFor } from '../_helpers.js';
import { emitEnvelopes } from './_envelopes.js';
import { relativeAge } from '../sync/status.js';

/**
 * `fob-email emails list` — envelopes for a folder, newest first. Human table by
 * default; `--json` emits the raw envelope array (for scripting / the `filter` pipe).
 * @param {any} argv
 * @param {any} [mbox] injected client (tests); defaults to `clientFor(argv)`.
 */
export async function listEmailsHandler(argv, mbox) {
  const client = mbox ?? clientFor(argv);
  try {
    // `--cached` reads the local mirror instead of the server. It never falls
    // back to live: the resource throws if the folder was never synced, so the
    // flag always means what it says (S1).
    const { data, syncedAt } = argv.cached
      ? client.sync.read({ folder: argv.folder, unseen: argv.unseen, limit: argv.limit })
      : await client.emails.list({ folder: argv.folder, unseenOnly: argv.unseen, limit: argv.limit });

    if (argv.cached && !argv.json) noteStaleness(syncedAt);
    emitEnvelopes(data, argv);
  } finally {
    await client.close();
  }
}

/**
 * Say how old a cached answer is, on stderr so it never pollutes piped data.
 * A mirror is only trustworthy when its staleness is visible at the point of
 * use, not just in `sync status`.
 * @param {string|null} syncedAt
 */
export function noteStaleness(syncedAt) {
  console.error(syncedAt ? `(cached — synced ${relativeAge(syncedAt)})` : '(cached)');
}
