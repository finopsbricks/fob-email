// @ts-check
import { safe, localOptions } from '../_helpers.js';
import { listEmailsHandler } from './list.js';
import { searchEmailsHandler } from './search.js';
import { showEmailHandler } from './show.js';
import { downloadEmailHandler } from './download.js';
import { markEmailHandler } from './mark.js';
import { moveEmailHandler } from './move.js';
import { deleteEmailHandler } from './delete.js';
import { sendEmailHandler } from './send.js';
import { filterHandler } from './filter.js';
import { composeOptions } from './_message.js';

/** Options shared by every id-targeting action (`--folder` enforces D4). */
const idOptions = (y) =>
  localOptions(y.positional('id', { describe: 'Message id (per-folder UID)', type: 'number' }))
    .option('account', { describe: 'Configured account name', type: 'string' })
    .option('folder', { describe: 'Mailbox folder', type: 'string', default: 'INBOX' })
    .option('json', { describe: 'Output raw JSON', type: 'boolean' });

/**
 * `fob-email emails <action>` — the emails resource command tree.
 */
export function buildEmailsSubcommands(yargs) {
  return yargs
    .usage('$0 emails <action> [options]')
    .command(
      'list',
      'List emails in a folder (newest first)',
      (y) =>
        localOptions(y)
          .option('account', { describe: 'Configured account name', type: 'string' })
          .option('folder', { describe: 'Mailbox folder', type: 'string', default: 'INBOX' })
          .option('unseen', { describe: 'Only unread messages', type: 'boolean' })
          .option('limit', { describe: 'Max messages', type: 'number', default: 50 })
          .option('fields', { describe: 'Columns (comma-separated)', type: 'string' })
          .option('cached', { describe: 'Read the local mirror (see `sync run`)', type: 'boolean' })
          .option('json', { describe: 'Output raw JSON', type: 'boolean' }),
      safe(listEmailsHandler),
    )
    .command(
      'search [query]',
      'Search a folder (IMAP SEARCH — keyword/header/date, not semantic)',
      (y) =>
        localOptions(y.positional('query', { describe: 'Text to match (headers + body)', type: 'string' }))
          .option('account', { describe: 'Configured account name', type: 'string' })
          .option('folder', { describe: 'Mailbox folder', type: 'string', default: 'INBOX' })
          .option('from', { describe: 'Match sender', type: 'string' })
          .option('subject', { describe: 'Match subject', type: 'string' })
          .option('since', { describe: 'On/after date (YYYY-MM-DD)', type: 'string' })
          .option('limit', { describe: 'Max messages', type: 'number', default: 50 })
          .option('fields', { describe: 'Columns (comma-separated)', type: 'string' })
          .option('cached', { describe: 'Read the local mirror (no body search)', type: 'boolean' })
          .option('json', { describe: 'Output raw JSON', type: 'boolean' }),
      safe(searchEmailsHandler),
    )
    .command('show <id>', 'Show one full email by id', idOptions, safe(showEmailHandler))
    .command(
      'download <id>',
      'Save a message\'s attachments to disk',
      (y) => idOptions(y).option('output', { alias: 'o', describe: 'Output directory', type: 'string' }),
      safe(downloadEmailHandler),
    )
    .command(
      'mark <id>',
      'Mark a message read or unread',
      (y) =>
        idOptions(y)
          .option('read', { describe: 'Mark as read', type: 'boolean' })
          .option('unread', { describe: 'Mark as unread', type: 'boolean' }),
      safe(markEmailHandler),
    )
    .command(
      'move <id>',
      'Move a message to another folder',
      (y) => idOptions(y).option('to', { describe: 'Destination folder', type: 'string', demandOption: true }),
      safe(moveEmailHandler),
    )
    .command(
      'delete <id>',
      'Permanently delete a message',
      (y) => idOptions(y).option('yes', { alias: 'y', describe: 'Confirm deletion', type: 'boolean' }),
      safe(deleteEmailHandler),
    )
    .command('send', 'Send an email (SMTP)', composeOptions, safe(sendEmailHandler))
    .command(
      'filter',
      'Filter an envelopes JSON array from stdin (pure, no connection)',
      (y) =>
        localOptions(y)
          .option('from', { describe: 'Substring match on From', type: 'string' })
          .option('to', { describe: 'Substring match on To', type: 'string' })
          .option('subject', { describe: 'Substring match on Subject', type: 'string' })
          .option('has-attachment', { describe: 'Only messages with an attachment', type: 'boolean' })
          .option('seen', { describe: 'Only seen messages', type: 'boolean' })
          .option('unseen', { describe: 'Only unseen messages', type: 'boolean' }),
      safe(filterHandler),
    )
    .demandCommand(1, 'Specify an action: list, search, show, download, mark, move, delete, send, filter');
}
