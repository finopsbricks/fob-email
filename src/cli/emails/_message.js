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
 * The shared compose option set (D3) — used by `emails send` and `drafts
 * create/edit`, so the flag vocabulary is defined once.
 * @param {any} y yargs
 * @param {{ requireTo?: boolean }} [opts]
 */
export function composeOptions(y, { requireTo = true } = {}) {
  return y
    .option('account', { describe: 'Configured account name', type: 'string' })
    .option('to', { describe: 'Recipient (repeatable)', type: 'string', array: true, demandOption: requireTo })
    .option('cc', { describe: 'Cc (repeatable)', type: 'string', array: true })
    .option('bcc', { describe: 'Bcc (repeatable)', type: 'string', array: true })
    .option('subject', { describe: 'Subject', type: 'string' })
    .option('body', { describe: 'Body text', type: 'string' })
    .option('body-file', { describe: 'Read body from a file', type: 'string' })
    .option('attach', { describe: 'Attach a file (repeatable)', type: 'string', array: true })
    .option('json', { describe: 'Output raw JSON', type: 'boolean' });
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
