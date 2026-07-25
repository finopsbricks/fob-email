import nodemailer from 'nodemailer';
import { resolveAccount } from '../config.js';

/**
 * A live SMTP transport — the only place that talks SMTP.
 *
 * The mirror of engine/imap.js `Session` for the send side. Same Pattern-C
 * credential seam: resolveAccount() layers env → config → per-call override and
 * validates the shape (via config.js's zod schema) before any protocol traffic.
 *
 * SMTP is optional on an account: if no `smtp` block is configured, user/pass
 * fall back to the IMAP credentials (the common single-app-password case) and
 * the host must be supplied. Constructing a Mailer verifies the connection so a
 * bad host/port fails with a clear message up front, not mid-send.
 */
export class Mailer {
  #transport;
  #from;

  constructor(transport, from) {
    this.#transport = transport;
    this.#from = from ?? null;
  }

  /** @param {string|object} [account] */
  static async connect(account) {
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
    return new Mailer(transport, user);
  }

  /**
   * Send a message. `message` is the normalized object from the CLI's shared
   * message-builder: { to, cc, bcc, subject, text, html, attachments }.
   * @param {{ to: string|string[], cc?: string|string[], bcc?: string|string[], subject?: string, text?: string, html?: string, from?: string, attachments?: Array<{ filename?: string, path?: string, content?: any, contentType?: string }> }} message
   * @returns {Promise<{ messageId: string|null, accepted: string[], rejected: string[] }>}
   */
  async send(message) {
    const info = await this.#transport.sendMail({ from: message.from || this.#from, ...message });
    return {
      messageId: info.messageId ?? null,
      accepted: (info.accepted ?? []).map(String),
      rejected: (info.rejected ?? []).map(String),
    };
  }

  async close() {
    try {
      this.#transport.close();
    } catch {
      /* already gone */
    }
  }
}
