/**
 * CLI entry point for fob-email.
 *
 *   fob-email <command> [options]
 *
 * JSON on stdout, logs on stderr, meaningful exit codes — so a worker and a
 * shell pipeline consume it the same way. Credentials come from
 * ~/.fob/fob-email/config.yml or the FOB_EMAIL_ACCOUNTS env map (see config.js);
 * the `config accounts` tree manages the former.
 */

import yargs from 'yargs';

import { safe } from './_helpers.js';
import { listHandler } from './list.js';
import { readHandler } from './read.js';
import { filterHandler } from './filter.js';
import { buildConfigSubcommands } from './config/index.js';

export function run(argv) {
  return yargs(argv)
    .scriptName('fob-email')
    .usage('$0 <command> [options]')
    .command(
      'list',
      'List envelopes in a folder (newest first, JSON to stdout)',
      (y) =>
        y
          .option('account', { describe: 'Configured account name', type: 'string' })
          .option('folder', { describe: 'Mailbox folder', type: 'string', default: 'INBOX' })
          .option('unseen', { describe: 'Only unseen messages', type: 'boolean' })
          .option('limit', { describe: 'Max messages', type: 'number', default: 50 }),
      safe(listHandler),
    )
    .command(
      'read <id>',
      'Read one full message by UID (JSON to stdout)',
      (y) =>
        y
          .positional('id', { describe: 'Message UID', type: 'number' })
          .option('account', { describe: 'Configured account name', type: 'string' })
          .option('folder', { describe: 'Mailbox folder', type: 'string', default: 'INBOX' }),
      safe(readHandler),
    )
    .command(
      'filter',
      'Filter an envelopes JSON array from stdin (pure, no connection)',
      (y) =>
        y
          .option('from', { describe: 'Substring match on From', type: 'string' })
          .option('to', { describe: 'Substring match on To', type: 'string' })
          .option('subject', { describe: 'Substring match on Subject', type: 'string' })
          .option('has-attachment', { describe: 'Only messages with an attachment', type: 'boolean' })
          .option('seen', { describe: 'Only seen messages', type: 'boolean' })
          .option('unseen', { describe: 'Only unseen messages', type: 'boolean' }),
      safe(filterHandler),
    )
    .command('config <resource>', 'Manage email account credentials (alias: accounts)', buildConfigSubcommands)
    .demandCommand(1, 'Specify a command. Try `fob-email --help`.')
    .strict()
    .help()
    .alias('h', 'help')
    .version()
    .alias('v', 'version')
    .parse();
}
