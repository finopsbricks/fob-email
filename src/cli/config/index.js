import { safe, localOptions } from '../_helpers.js';
import { listConfigHandler } from './list.js';
import { addConfigHandler } from './add.js';
import { useConfigHandler } from './use.js';
import { removeConfigHandler } from './remove.js';
import { refreshConfigHandler } from './refresh.js';

/**
 * The stored object is a credential "profile" — a named set of connection
 * credentials. fob-email's profiles are email accounts, so `accounts` is the
 * domain alias (not `mailboxes` — that collides with IMAP folders). `config` is
 * a namespace, not the object: `fob-email config accounts <action>`.
 */
function buildProfilesSubcommands(yargs) {
  return yargs
    .usage('$0 config profiles <action> [options]')
    .command(
      'list',
      'List accounts (current marked with *)',
      (y) => localOptions(y).option('json', { describe: 'Output raw JSON', type: 'boolean' }),
      safe(listConfigHandler),
    )
    .command(
      'add <name>',
      "Add or update an account's IMAP/SMTP credentials",
      (y) =>
        localOptions(y.positional('name', { describe: 'Account name', type: 'string' }))
          .option('imap-host', { describe: 'IMAP host', type: 'string', demandOption: true })
          .option('imap-port', { describe: 'IMAP port', type: 'number', default: 993 })
          .option('imap-user', { describe: 'IMAP username', type: 'string', demandOption: true })
          .option('imap-pass', { describe: 'IMAP password (app password)', type: 'string', demandOption: true })
          .option('imap-tls', { describe: 'Use TLS for IMAP', type: 'boolean', default: true })
          .option('smtp-host', { describe: 'SMTP host (enables sending)', type: 'string' })
          .option('smtp-port', { describe: 'SMTP port', type: 'number', default: 465 })
          .option('smtp-user', { describe: 'SMTP username (defaults to --imap-user)', type: 'string' })
          .option('smtp-pass', { describe: 'SMTP password (defaults to --imap-pass)', type: 'string' })
          .option('smtp-secure', { describe: 'Use TLS for SMTP', type: 'boolean', default: true })
          .option('verify', {
            describe: 'Connect to verify creds and cache the account profile (--no-verify to skip)',
            type: 'boolean',
            default: true,
          }),
      safe(addConfigHandler),
    )
    .command(
      'use <name>',
      'Set the current account',
      (y) => y.positional('name', { describe: 'Account name', type: 'string' }),
      safe(useConfigHandler),
    )
    .command(
      ['remove <name>', 'rm <name>'],
      'Remove an account',
      (y) => y.positional('name', { describe: 'Account name', type: 'string' }),
      safe(removeConfigHandler),
    )
    .command(
      'refresh [name]',
      "Re-probe an account's profile — address, provider, thread strategy, folders (--all for every account)",
      (y) =>
        localOptions(y.positional('name', { describe: 'Account name (omit with --all)', type: 'string' }))
          .option('all', { describe: 'Refresh every account', type: 'boolean' }),
      safe(refreshConfigHandler),
    )
    .demandCommand(1, 'Specify an action: list, add, use, remove, refresh');
}

export function buildConfigSubcommands(yargs) {
  return yargs
    .usage('$0 config <resource> <action> [options]')
    .command(
      ['profiles', 'accounts'],
      'Manage email account credentials (alias: accounts)',
      buildProfilesSubcommands,
    )
    .demandCommand(1, 'Specify a resource: profiles (alias: accounts)');
}
