// @ts-check
import { clientFor } from '../_helpers.js';
import { formatTable } from '../../utils/format.js';

/**
 * `fob-email sync status` — what is mirrored, and how old it is.
 *
 * Age is the point of this command. A mirror is only trustworthy if its
 * staleness is visible, so the age column is rendered in plain relative terms
 * ("4m ago") rather than a timestamp a reader has to subtract.
 *
 * @param {any} argv
 * @param {any} [mbox] injected client (tests); defaults to `clientFor(argv)`.
 */
export async function syncStatusHandler(argv, mbox) {
  const client = mbox ?? clientFor(argv);
  try {
    const rows = await client.sync.status({ folder: argv.folder });

    if (argv.json) {
      console.log(JSON.stringify(rows, null, 2));
      return;
    }

    if (rows.length === 0) {
      console.log('(nothing synced yet — run `fob-email sync run`)');
      return;
    }

    console.log(
      formatTable(
        ['FOLDER', 'MESSAGES', 'LAST SYNCED'],
        rows.map((r) => [r.folder, String(r.messages), relativeAge(r.lastSyncedAt)]),
      ),
    );
  } finally {
    await client.close();
  }
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
