// @ts-check
import { clientFor } from '../_helpers.js';
import { formatSection, formatField, formatBytes } from '../../utils/format.js';

/** @param {any} a */
function addrStr(a) {
  if (!a) return '';
  return a.name ? `${a.name} <${a.addr ?? ''}>` : a.addr ?? '';
}

/**
 * `fob-email emails show <id>` — one full message. Human-formatted by default;
 * `--json` emits the raw message object.
 * @param {any} argv
 * @param {any} [mbox] injected client (tests); defaults to `clientFor(argv)`.
 */
export async function showEmailHandler(argv, mbox) {
  const client = mbox ?? clientFor(argv);
  try {
    const email = await client.emails.get(Number(argv.id), { folder: argv.folder });

    if (argv.json) {
      console.log(JSON.stringify(email, null, 2));
      return;
    }

    const lines = [
      formatSection(`Email #${email.id}`),
      formatField('From', addrStr(email.from), 8),
      formatField('To', (email.to || []).map(addrStr).filter(Boolean).join(', '), 8),
      formatField('Subject', email.subject, 8),
      formatField('Date', email.date, 8),
    ];
    if (email.messageId) lines.push(formatField('Msg-Id', email.messageId, 8));
    lines.push('', email.text || '(no text body)');

    if (email.attachments?.length) {
      lines.push('', formatSection('Attachments'));
      for (const a of email.attachments) {
        lines.push(`  ${a.filename ?? '(unnamed)'}  (${a.contentType ?? 'unknown'}, ${formatBytes(a.size)})`);
      }
    }
    console.log(lines.join('\n'));
  } finally {
    await client.close();
  }
}
