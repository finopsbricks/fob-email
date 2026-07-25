import nodemailer from 'nodemailer';
import { resolveAccount } from '../config.js';

/**
 * A live SMTP transport — the only place that talks SMTP.
 *
 * The mirror of engine/imap.js `connectSession` for the send side: a functional
 * factory (WIP decision D5) whose connection lives in a closure variable. Same
 * Pattern-C credential seam — resolveAccount() layers env → config → per-call
 * override and validates the shape (via config.js's zod schema) before any
 * protocol traffic.
 *
 * SMTP is optional on an account: if no `smtp` block is configured, user/pass
 * fall back to the IMAP credentials (the common single-app-password case) and
 * the host must be supplied. `verify()` on connect surfaces a bad host/port up
 * front, not mid-send.
 *
 * @param {string|object} [account] account name, or a raw config object.
 */
export async function connectMailer(account) {
  const cfg = resolveAccount(account);
  const smtp = cfg.smtp ?? {};
  const host = smtp.host || cfg.imap.host;
  const user = smtp.user || cfg.imap.user;
  const pass = smtp.pass || cfg.imap.pass;
  if (!host) throw new Error('No SMTP host configured for this account (set smtp.host).');

  const transport = nodemailer.createTransport({
    host,
    port: smtp.port ?? 465,
    secure: smtp.secure ?? true,
    auth: { user, pass },
  });
  await transport.verify();

  return {
    /**
     * Send a message. `message` is the normalized object from the CLI's shared
     * message-builder: { to, cc, bcc, subject, text, html, attachments }.
     */
    send: async (message) => {
      const info = await transport.sendMail({ from: message.from || user, ...message });
      return {
        messageId: info.messageId ?? null,
        accepted: (info.accepted ?? []).map(String),
        rejected: (info.rejected ?? []).map(String),
      };
    },

    close: async () => {
      try {
        transport.close();
      } catch {
        /* already gone */
      }
    },
  };
}
