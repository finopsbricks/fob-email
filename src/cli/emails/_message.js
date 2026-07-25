// @ts-check
/**
 * D3 — the shared message-builder. Maps the compose flags
 * (`--to`/`--cc`/`--bcc`/`--subject`/`--body`/`--body-file`/repeatable `--attach`)
 * to the normalized message object the engine/SMTP layer sends. Used by both
 * `emails send` (one-shot) and, later, `drafts create/edit/send` — so body and
 * attachment assembly lives in exactly one place.
 */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

/** @param {any} v @returns {string[]} */
function toArray(v) {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

/**
 * @param {any} argv
 * @returns {{ to: string[], cc?: string[], bcc?: string[], subject?: string, text?: string, attachments?: Array<{ path: string, filename: string }> }}
 */
export function buildMessage(argv) {
  const to = toArray(argv.to);
  if (to.length === 0) throw new Error('--to <address> is required (repeatable).');

  if (argv.body != null && argv.bodyFile != null) {
    throw new Error('Specify only one of --body or --body-file.');
  }
  const text = argv.bodyFile != null ? readFileSync(argv.bodyFile, 'utf8') : argv.body;

  const attachments = toArray(argv.attach).map((p) => ({ path: p, filename: basename(p) }));

  /** @type {any} */
  const message = { to, subject: argv.subject, text };
  const cc = toArray(argv.cc);
  const bcc = toArray(argv.bcc);
  if (cc.length) message.cc = cc;
  if (bcc.length) message.bcc = bcc;
  if (attachments.length) message.attachments = attachments;
  return message;
}
