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

import { buildEmailsSubcommands } from './emails/index.js';
import { buildThreadsSubcommands } from './threads/index.js';
import { buildDraftsSubcommands } from './drafts/index.js';
import { buildFoldersSubcommands } from './folders/index.js';
import { buildConfigSubcommands } from './config/index.js';

export function run(argv) {
  return yargs(argv)
    .scriptName('fob-email')
    .usage('$0 <resource> <action> [options]')
    .command('emails <action>', 'Read and manage emails', buildEmailsSubcommands)
    .command('threads <action>', 'Read conversations', buildThreadsSubcommands)
    .command('drafts <action>', 'Compose, save, and send drafts', buildDraftsSubcommands)
    .command('folders <action>', 'List and manage folders', buildFoldersSubcommands)
    .command('config <resource>', 'Manage email account credentials (alias: accounts)', buildConfigSubcommands)
    .demandCommand(1, 'Specify a resource. Try `fob-email --help`.')
    .strict()
    .help()
    .alias('h', 'help')
    .version()
    .alias('v', 'version')
    .parse();
}
