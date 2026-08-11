// @ts-check
import { clientFor } from '../_helpers.js';
import { formatTable } from '../../utils/format.js';
import { accountNames } from '../../config.js';

/**
 * `fob-email sync status` — what is mirrored, and how old it is.
 *
 * Age is the point of this command. A mirror is only trustworthy if its
 * staleness is visible, so the age column is rendered in plain relative terms
 * ("4m ago") rather than a timestamp a reader has to subtract.
 *
 * Reads only the local store — no connection is opened, so `--all-accounts`
 * costs nothing but a few SQLite queries and works with the network down.
 *
 * @param {any} argv
 * @param {any} [mbox] injected client (tests). With `--all-accounts` this is a
 *   factory `(account) => client`; otherwise a single client.
 */
export async function syncStatusHandler(argv, mbox) {
  const accounts = argv.allAccounts ? (argv._accounts ?? accountNames()) : [argv.account];
  const clientOf = (account) =>
    typeof mbox === 'function' ? mbox(account) : (mbox ?? clientFor({ ...argv, account }));

  /** @type {any[]} */
  const rows = [];
  for (const account of accounts) {
    const client = clientOf(account);
    try {
      rows.push(...(await client.sync.status({ folder: argv.folder })));
    } finally {
      await client.close();
    }
  }

  if (argv.json) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }

  if (rows.length === 0) {
    console.log('(nothing synced yet — run `fob-email sync run`)');
    return;
  }

  // The account column only earns its width when more than one is in play.
  const multi = argv.allAccounts;
  console.log(
    formatTable(
      multi ? ['ACCOUNT', 'FOLDER', 'MESSAGES', 'LAST SYNCED'] : ['FOLDER', 'MESSAGES', 'LAST SYNCED'],
      rows.map((r) =>
        multi
          ? [r.account, r.folder, String(r.messages), relativeAge(r.lastSyncedAt)]
          : [r.folder, String(r.messages), relativeAge(r.lastSyncedAt)],
      ),
    ),
  );
}

/** Coarse relative age — precision past "hours" is noise for a freshness check. */
function relativeAge(iso, now = Date.now()) {
  if (!iso) return 'never';
  const ms = now - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return String(iso);

  const min = Math.floor(ms / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;

  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;

  return `${Math.floor(hr / 24)}d ago`;
}

export { relativeAge };
