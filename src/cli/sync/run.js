// @ts-check
import { clientFor } from '../_helpers.js';
import { formatField } from '../../utils/format.js';
import { accountNames } from '../../config.js';

/**
 * `fob-email sync run` — pull folders into the local mirror.
 *
 * Three axes, all opt-in and all still strictly user-triggered (there is no
 * daemon): one folder or `--all-folders`, one account or `--all-accounts`.
 *
 * Reports the *mode* it ran in, because the three cases mean very different
 * things to a user waiting on it: `incremental` (cheap, fetched only new mail),
 * `full` (first sync or `--full`), and `reset` — the folder's UIDVALIDITY moved,
 * so every mirrored id was invalidated and the folder was rebuilt from scratch
 * (D4). Silently doing a full rebuild under the label "sync" would hide a real
 * server-side event.
 *
 * @param {any} argv
 * @param {any} [mbox] injected client (tests). With `--all-accounts` this is a
 *   factory `(account) => client`; otherwise a single client.
 */
export async function syncRunHandler(argv, mbox) {
  const accounts = argv.allAccounts ? (argv._accounts ?? accountNames()) : [argv.account];
  if (argv.allAccounts && !accounts.length) {
    throw new Error('No accounts configured. Run `fob-email config accounts add <name>` first.');
  }

  /** A client per account; a single injected client stands in for the one-account case. */
  const clientOf = (account) =>
    typeof mbox === 'function' ? mbox(account) : (mbox ?? clientFor({ ...argv, account }));

  const runs = [];
  for (const account of accounts) {
    // Each account is a separate connection, closed before the next opens —
    // syncing ten mailboxes should not hold ten sockets at once.
    const client = clientOf(account);
    try {
      runs.push(
        argv.allFolders
          ? await client.sync.runAll({ full: argv.full, limit: argv.limit ?? null })
          : wrapOne(await client.sync.run({ folder: argv.folder, full: argv.full, limit: argv.limit ?? null })),
      );
    } finally {
      await client.close();
    }
  }

  if (argv.json) {
    // A single-folder, single-account run stays the flat object it always was,
    // so existing scripts keep parsing. Only the multi forms nest.
    console.log(JSON.stringify(argv.allAccounts || argv.allFolders ? runs : runs[0].folders[0], null, 2));
    return;
  }

  // Detail view only when the user asked for exactly one folder of one account.
  // Keying off `runs`/`folders` lengths instead would silently switch format
  // when an `--all-folders` sync happened to yield one folder — same command,
  // different output shape.
  const single = !argv.allFolders && !argv.allAccounts;
  for (const run of runs) report(run, { single });

  // Failures are surfaced *after* the results and on stderr: the sync did
  // happen for every other folder, and a script piping stdout should still get
  // clean output. Exit non-zero so a caller can tell partial from complete.
  const failed = runs.flatMap((r) => r.failed ?? []);
  if (failed.length) {
    console.error(`\n${failed.length} folder(s) failed:`);
    for (const f of failed) console.error(`  ${f.folder}: ${f.error}`);
    process.exitCode = 1;
  }
}

/** Give a single-folder result the same shape `runAll` returns, so one reporter serves both. */
function wrapOne(result) {
  return {
    account: result.account,
    folders: [result],
    failed: [],
    fetched: result.fetched,
    vanished: result.vanished,
    total: result.total,
  };
}

/** @param {{account: string, folders: any[], failed: any[], fetched: number, total: number}} run */
function report(run, { single }) {
  if (single && run.folders.length) {
    const only = run.folders[0];
    if (only.mode === 'reset') noteReset(only);
    console.log(formatField('Folder', `${only.folder} (${only.account})`));
    console.log(formatField('Mode', modeLabel(only)));
    console.log(formatField('Fetched', String(only.fetched)));
    if (only.flagsUpdated) console.log(formatField('Flags updated', String(only.flagsUpdated)));
    if (only.vanished) console.log(formatField('Removed', String(only.vanished)));
    console.log(formatField('Mirrored', String(only.total)));
    return;
  }

  // Multi-folder: one line per folder, then a total. A per-folder table would
  // bury the number most users came for.
  for (const f of run.folders) if (f.mode === 'reset') noteReset(f);
  console.log(`${run.account}:`);
  for (const f of run.folders) {
    const bits = [`${f.fetched} new`];
    if (f.flagsUpdated) bits.push(`${f.flagsUpdated} flags`);
    if (f.vanished) bits.push(`${f.vanished} removed`);
    console.log(`  ${f.folder} — ${bits.join(', ')} (${f.total} mirrored, ${modeLabel(f)})`);
  }
  console.log(formatField('  Total', `${run.fetched} new, ${run.total} mirrored`));
}

function noteReset(result) {
  console.error(
    `Note: "${result.folder}" was reset on the server (UIDVALIDITY changed) — ` +
      'the local copy was rebuilt and previously listed ids are stale.',
  );
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
