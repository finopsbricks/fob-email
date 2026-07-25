/**
 * CLI entry point for fob-email.
 *
 *   fob-email <resource> <action> [target] [options]
 *
 * A resource/action grammar over the objects a finance FDE thinks in — emails,
 * folders, drafts — not IMAP internals. Human-readable output by default;
 * `--json` on every read command emits the raw payload (data on stdout,
 * diagnostics on stderr) so a shell pipeline or a worker consumes it cleanly.
 * Credentials come from ~/.fob/fob-email/config.yml or the FOB_EMAIL_ACCOUNTS env
 * map (see config.js); the `config accounts` tree manages the former.
 */

import yargs from 'yargs';

import { safe } from './_helpers.js';
import { filterHandler } from './filter.js';
import { buildEmailsSubcommands } from './emails/index.js';
import { buildConfigSubcommands } from './config/index.js';

export function run(argv) {
  return yargs(argv)
    .scriptName('fob-email')
    .usage('$0 <resource> <action> [options]')
    .command('emails <action>', 'Read and manage emails', buildEmailsSubcommands)
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
    .demandCommand(1, 'Specify a resource. Try `fob-email --help`.')
    .strict()
    .help()
    .alias('h', 'help')
    .version()
    .alias('v', 'version')
    .parse();
}
