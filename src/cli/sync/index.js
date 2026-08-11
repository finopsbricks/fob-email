// @ts-check
import { safe, localOptions } from '../_helpers.js';
import { syncRunHandler } from './run.js';
import { syncStatusHandler } from './status.js';
import { syncClearHandler } from './clear.js';

/**
 * `fob-email sync <action>` — the local mirror.
 *
 * `sync` is a resource noun here, following the family grammar's no-exceptions
 * rule (`<resource> <action>`); `run`/`status`/`clear` are its actions. It is
 * not an email object, but neither is `config`, and the same shape applies.
 *
 * Sync is always **user-triggered** — there is no daemon and no auto-refresh.
 */
export function buildSyncSubcommands(yargs) {
  return yargs
    .usage('$0 sync <action> [options]')
    .command(
      'run',
      'Pull folders into the local mirror',
      (y) =>
        localOptions(y)
          .option('folder', { describe: 'Folder to sync', type: 'string', default: 'INBOX' })
          .option('all-folders', { describe: 'Sync every selectable folder', type: 'boolean' })
          .option('all-accounts', { describe: 'Sync every configured account', type: 'boolean' })
          .option('full', { describe: 'Ignore stored cursors and resync from scratch', type: 'boolean' })
          .option('limit', {
            describe: 'On a first/full sync, mirror only the newest N messages',
            type: 'number',
          })
          .option('account', { describe: 'Configured account name', type: 'string' })
          // No `.conflicts('folder', 'all-folders')`: `--folder` carries a
          // default, so yargs would see it as always-set and reject every
          // `--all-folders` run. `--all-folders` simply wins in the handler.
          .option('json', { describe: 'Output raw JSON', type: 'boolean' }),
      safe(syncRunHandler),
    )
    .command(
      'status',
      'Show what is mirrored locally and how stale it is',
      (y) =>
        localOptions(y)
          .option('folder', { describe: 'Limit to one folder', type: 'string' })
          .option('all-accounts', { describe: 'Show every configured account', type: 'boolean' })
          .option('account', { describe: 'Configured account name', type: 'string' })
          .option('json', { describe: 'Output raw JSON', type: 'boolean' }),
      safe(syncStatusHandler),
    )
    .command(
      'clear',
      'Delete mirrored data (it can always be re-synced)',
      (y) =>
        localOptions(y)
          .option('folder', { describe: 'Limit to one folder', type: 'string' })
          .option('yes', { alias: 'y', describe: 'Skip the confirmation', type: 'boolean' })
          .option('account', { describe: 'Configured account name', type: 'string' })
          .option('json', { describe: 'Output raw JSON', type: 'boolean' }),
      safe(syncClearHandler),
    )
    .demandCommand(1, 'Specify an action: run, status, clear');
}
