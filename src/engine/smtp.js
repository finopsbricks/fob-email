import nodemailer from 'nodemailer';
import { resolveAccount } from '../config.js';
import { TROUBLESHOOTING_DOCS_URL } from '../links.js';

/**
 * A live SMTP transport — the only place that talks SMTP.
 *
 * The mirror of engine/imap.js `connectSession` for the send side: a functional
 * factory (WIP decision D5) whose connection lives in a closure variable. Same
 * Pattern-C credential seam — resolveAccount() layers env → config → per-call
 * override and validates the shape (via config.js's zod schema) before any
 * protocol traffic.
 *
 * SMTP is optional on an account, but sending needs `smtp.host`: there is no
 * fallback to the IMAP host, which is almost never an SMTP server and only
 * produced a confusing connection error. User/pass fall back to the IMAP
 * credentials (the common single-app-password case). `verify()` on connect surfaces a bad host/port up
 * front, not mid-send.
 *
 * @param {string|object} [account] account name, or a raw config object.
 */
export async function connectMailer(account) {
  const cfg = resolveAccount(account);
  const smtp = cfg.smtp ?? {};
  const host = smtp.host;
  const user = smtp.user || cfg.imap.user;
  const pass = smtp.pass || cfg.imap.pass;
  if (!host) {
    throw new Error(
      'Sending needs an SMTP server, and this account has none. ' +
        'Add the account again with --smtp-host (for example smtp.gmail.com), or set smtp.host in FOB_EMAIL_ACCOUNTS. ' +
        `See ${TROUBLESHOOTING_DOCS_URL}#sending-fails-but-reading-works`,
    );
  }

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
      // A stored draft is sent as its raw RFC 822 source; a composed message is
      // sent field-by-field with the account's from filled in.
      const payload = message.raw ? { raw: message.raw } : { from: message.from || user, ...message };
      const info = await transport.sendMail(payload);
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
