/**
 * `fob-email getting-started` — an in-band setup walkthrough aimed at LLM agents
 * driving the CLI on a user's behalf. Mirrors `fob-stm getting-started`.
 *
 * It first checks for configured accounts: if one already exists, setup is done
 * and the command says so (naming the current account) rather than walking the
 * agent through credentials it already has. Only when nothing is configured does
 * it print the full add-an-account walkthrough.
 *
 * The walkthrough leads with Gmail because that is the common case, and Gmail is
 * where setup actually goes wrong: IMAP rejects the normal account password, so
 * an app password (16 chars, 2-Step Verification required) is mandatory. An agent
 * that does not know this burns turns on `AUTHENTICATIONFAILED`.
 */

import { listAccounts } from '../config.js';

function alreadyConfigured({ current, accounts, path }) {
  const names = accounts.map((a) => a.name).join(', ');
  const active = accounts.find((a) => a.current);
  const lines = [
    'Setup is already complete — no need to run through getting started.',
    '',
    `Configured account(s): ${names}`,
    current ? `Active account:        ${current}` : 'Active account:        (none selected)',
    active?.address ? `Mailbox:               ${active.address}` : null,
    `Config file:           ${path}`,
    '',
    'You can start running commands now, for example:',
    '',
    '  fob-email config accounts list      # confirm the active account',
    '  fob-email folders list',
    '  fob-email emails list --limit 10',
    '  fob-email threads list --limit 10',
    '',
    'Only re-run setup to add another mailbox:',
    '',
    '  fob-email config accounts add <name> --imap-host <host> --imap-user <user> --imap-pass <pass>',
    '  fob-email config accounts use <name>   # switch the active account',
  ];
  return lines.filter((l) => l !== null).join('\n');
}

function notConfigured({ path }) {
  const lines = [
    'No account is configured yet. Follow these steps to get started.',
    '',
    'Note for automated agents: always check for an existing account first with',
    '`fob-email config accounts list`. If one is configured, setup is complete —',
    'skip the steps below and start running commands.',
    '',
    'Gmail (most common)',
    '',
    '1. Gmail rejects your normal account password over IMAP — you need an app',
    '   password. Enable 2-Step Verification, then create one at',
    '   https://myaccount.google.com/apppasswords',
    '   Copy the 16-character password (shown once; spaces are optional).',
    '',
    '2. Add the account (ask the user for the app password — never invent one):',
    '',
    '   fob-email config accounts add personal \\',
    '     --imap-host imap.gmail.com \\',
    '     --imap-user you@gmail.com \\',
    '     --imap-pass xxxxxxxxxxxxxxxx \\',
    '     --smtp-host smtp.gmail.com',
    '',
    '   --imap-port (993) and --smtp-port (465) already default to Gmail\'s ports.',
    '   Pass --smtp-host to enable sending; SMTP reuses the IMAP user/password',
    '   unless you override them. Omit it for a read-only account.',
    '',
    '   On success this verifies the credentials and caches the mailbox address,',
    '   provider, and thread strategy. Use --no-verify to skip the network.',
    '',
    '3. Confirm it works:',
    '',
    '   fob-email config accounts list',
    '   fob-email folders list',
    '',
    'Other providers',
    '',
    '   Same command with your provider\'s IMAP/SMTP hosts. Most hosts that require',
    '   2FA also require an app-specific password:',
    '',
    '     Outlook / Microsoft 365   outlook.office365.com   smtp.office365.com (587, --no-smtp-secure)',
    '     Fastmail                  imap.fastmail.com       smtp.fastmail.com',
    '     Yahoo                     imap.mail.yahoo.com     smtp.mail.yahoo.com',
    '',
    `Credentials are stored at ${path} (mode 0600).`,
    'For workers/CI, set the FOB_EMAIL_ACCOUNTS env var instead — a JSON map of',
    '{ name: { imap, smtp } }, which takes precedence over the config file.',
    '',
    'See docs/gmail-setup.md for the full Gmail walkthrough and troubleshooting.',
  ];
  return lines.join('\n');
}

export async function gettingStartedHandler() {
  const info = listAccounts();
  console.log(info.accounts.length > 0 ? alreadyConfigured(info) : notConfigured(info));
}
