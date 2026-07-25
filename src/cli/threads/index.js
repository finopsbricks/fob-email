// @ts-check
import { safe } from '../_helpers.js';
import { listThreadsHandler } from './list.js';
import { showThreadHandler } from './show.js';

/**
 * `fob-email threads <action>` — the threads resource command tree. The
 * resolution strategy is read from the account profile (D6), not chosen here.
 */
export function buildThreadsSubcommands(yargs) {
  return yargs
    .usage('$0 threads <action> [options]')
    .command(
      'list',
      'List conversations in a folder (newest activity first)',
      (y) =>
        y
          .option('account', { describe: 'Configured account name', type: 'string' })
          .option('folder', { describe: 'Mailbox folder', type: 'string', default: 'INBOX' })
          .option('limit', { describe: 'Max threads', type: 'number', default: 50 })
          .option('json', { describe: 'Output raw JSON', type: 'boolean' }),
      safe(listThreadsHandler),
    )
    .command(
      'show <id>',
      'Show the full conversation containing a message',
      (y) =>
        y
          .positional('id', { describe: 'Message id (per-folder UID)', type: 'number' })
          .option('account', { describe: 'Configured account name', type: 'string' })
          .option('folder', { describe: 'Mailbox folder', type: 'string', default: 'INBOX' })
          .option('json', { describe: 'Output raw JSON', type: 'boolean' }),
      safe(showThreadHandler),
    )
    .demandCommand(1, 'Specify an action: list, show');
}
