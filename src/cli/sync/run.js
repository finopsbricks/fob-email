// @ts-check
import { clientFor } from '../_helpers.js';
import { formatField } from '../../utils/format.js';

/**
 * `fob-email sync run` — pull a folder into the local mirror.
 *
 * Reports the *mode* it ran in, because the three cases mean very different
 * things to a user waiting on it: `incremental` (cheap, fetched only new mail),
 * `full` (first sync or `--full`), and `reset` — the folder's UIDVALIDITY moved,
 * so every mirrored id was invalidated and the folder was rebuilt from scratch
 * (D4). Silently doing a full rebuild under the label "sync" would hide a real
 * server-side event.
 *
 * @param {any} argv
 * @param {any} [mbox] injected client (tests); defaults to `clientFor(argv)`.
 */
export async function syncRunHandler(argv, mbox) {
  const client = mbox ?? clientFor(argv);
  try {
    const result = await client.sync.run({
      folder: argv.folder,
      full: argv.full,
      limit: argv.limit ?? null,
    });

    if (argv.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    if (result.mode === 'reset') {
      console.error(
        `Note: "${result.folder}" was reset on the server (UIDVALIDITY changed) — ` +
          'the local copy was rebuilt and previously listed ids are stale.',
      );
    }

    console.log(formatField('Folder', `${result.folder} (${result.account})`));
    console.log(formatField('Mode', modeLabel(result)));
    console.log(formatField('Fetched', String(result.fetched)));
    if (result.flagsUpdated) console.log(formatField('Flags updated', String(result.flagsUpdated)));
    if (result.vanished) console.log(formatField('Removed', String(result.vanished)));
    console.log(formatField('Mirrored', String(result.total)));
  } finally {
    await client.close();
  }
}

/**
 * Name the mode, noting when an incremental sync had to fall back to re-reading
 * the folder. That distinction is the difference between a cheap sync and an
 * expensive one, and it is a property of the *server* (no CONDSTORE) rather than
 * anything the user did — so it is worth showing rather than hiding.
 */
function modeLabel({ mode, flagMode }) {
  if (mode !== 'incremental') return mode;
  return flagMode === 'refetch' ? 'incremental (full flag re-read — no CONDSTORE)' : 'incremental';
}
