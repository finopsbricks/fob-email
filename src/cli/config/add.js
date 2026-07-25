import { addAccount } from '../../config.js';

/**
 * `fob-email config accounts add <name>` — store IMAP (and optional SMTP)
 * connection credentials for an account (Pattern C).
 *
 * SMTP is enabled by passing --smtp-host; its user/pass default to the IMAP
 * ones (the common single-app-password case). Identity caching (the mailbox
 * address) is resolved in Phase 4's `refresh`, never here — adding creds must
 * not require a network round-trip (decision G).
 */
export function addConfigHandler(argv) {
  const imap = {
    host: argv['imap-host'],
    port: argv['imap-port'],
    user: argv['imap-user'],
    pass: argv['imap-pass'],
    tls: argv['imap-tls'],
  };

  let smtp;
  if (argv['smtp-host']) {
    smtp = {
      host: argv['smtp-host'],
      port: argv['smtp-port'],
      user: argv['smtp-user'] ?? argv['imap-user'],
      pass: argv['smtp-pass'] ?? argv['imap-pass'],
      secure: argv['smtp-secure'],
    };
  }

  addAccount(argv.name, { imap, smtp });
  console.log(`Saved account '${argv.name}' to the fob-email config (mode 0600).`);
}
