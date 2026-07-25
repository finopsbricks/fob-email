// @ts-check
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { clientFor } from '../_helpers.js';
import { formatBytes } from '../../utils/format.js';

/**
 * `fob-email emails download <id>` — save a message's attachments to disk (the
 * finops use: pull invoices/receipts). Writes to `--output` dir (default cwd);
 * "Wrote <path>" notices go to stderr so stdout stays a clean data channel.
 * `--json` emits the written-file metadata instead of writing progress to stdout.
 * @param {any} argv
 * @param {any} [mbox] injected client (tests); defaults to `clientFor(argv)`.
 */
export async function downloadEmailHandler(argv, mbox) {
  const client = mbox ?? clientFor(argv);
  try {
    const attachments = await client.emails.download(Number(argv.id), { folder: argv.folder });
    const dir = argv.output || '.';
    if (attachments.length === 0) {
      console.error('(no attachments)');
      if (argv.json) console.log('[]');
      return;
    }
    mkdirSync(dir, { recursive: true });

    const written = [];
    for (const [i, a] of attachments.entries()) {
      const name = a.filename || `attachment-${i + 1}`;
      const path = join(dir, basename(name));
      writeFileSync(path, a.content);
      written.push({ path, filename: name, contentType: a.contentType, size: a.size });
      console.error(`Wrote ${path} (${formatBytes(a.size)})`);
    }

    if (argv.json) console.log(JSON.stringify(written, null, 2));
  } finally {
    await client.close();
  }
}
