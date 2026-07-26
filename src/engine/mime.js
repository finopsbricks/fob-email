import MailComposer from 'nodemailer/lib/mail-composer/index.js';

/**
 * Compile a normalized message object (the CLI's D3 shape) into a raw RFC 822
 * buffer — what IMAP `APPEND` needs to store a draft. Uses nodemailer's
 * MailComposer, so `{ to, cc, bcc, subject, text, html, attachments:[{path}] }`
 * (including file attachments by path) all work the same as an SMTP send.
 *
 * @param {object} message
 * @returns {Promise<Buffer>}
 */
export function buildMime(message) {
  return new Promise((resolve, reject) => {
    new MailComposer(message).compile().build((err, raw) => (err ? reject(err) : resolve(raw)));
  });
}
