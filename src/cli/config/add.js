import { addAccount } from '../../config.js';
import { refreshProfile } from './_identity.js';

/**
 * `fob-email config accounts add <name>` — store IMAP (and optional SMTP)
 * connection credentials for an account (Pattern C).
 *
 * SMTP is enabled by passing --smtp-host; its user/pass default to the IMAP
 * ones (the common single-app-password case). After saving, best-effort connect
 * to verify the creds and cache the mailbox address (decision G) — this never
 * blocks the save, and --no-verify skips the network entirely (scripts/offline).
 */
export async function addConfigHandler(argv) {
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

  if (argv.verify !== false) {
    const profile = await refreshProfile(argv.name);
    if (profile?.address) {
      console.log(
        `Verified — authenticates as ${profile.address} (${profile.provider}, threads: ${profile.threadStrategy}).`,
      );
    }
  }
}
