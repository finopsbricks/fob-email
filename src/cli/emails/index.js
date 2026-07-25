// @ts-check
import { safe } from '../_helpers.js';
import { listEmailsHandler } from './list.js';
import { showEmailHandler } from './show.js';

/**
 * `fob-email emails <action>` — the emails resource command tree.
 * Phase 2 ships `list` + `show`; `search`/`download`/`mark`/`move`/`delete`/`send`
 * join in Phase 3.
 */
export function buildEmailsSubcommands(yargs) {
  return yargs
    .usage('$0 emails <action> [options]')
    .command(
      'list',
      'List emails in a folder (newest first)',
      (y) =>
        y
          .option('account', { describe: 'Configured account name', type: 'string' })
          .option('folder', { describe: 'Mailbox folder', type: 'string', default: 'INBOX' })
          .option('unseen', { describe: 'Only unread messages', type: 'boolean' })
          .option('limit', { describe: 'Max messages', type: 'number', default: 50 })
          .option('fields', { describe: 'Columns (comma-separated)', type: 'string' })
          .option('json', { describe: 'Output raw JSON', type: 'boolean' }),
      safe(listEmailsHandler),
    )
    .command(
      'show <id>',
      'Show one full email by id',
      (y) =>
        y
          .positional('id', { describe: 'Message id (per-folder UID)', type: 'number' })
          .option('account', { describe: 'Configured account name', type: 'string' })
          .option('folder', { describe: 'Mailbox folder', type: 'string', default: 'INBOX' })
          .option('json', { describe: 'Output raw JSON', type: 'boolean' }),
      safe(showEmailHandler),
    )
    .demandCommand(1, 'Specify an action: list, show');
}
