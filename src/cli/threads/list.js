// @ts-check
import { clientFor } from '../_helpers.js';
import { formatTable, formatDate } from '../../utils/format.js';

function truncate(s, n) {
  const str = s ?? '';
  return str.length > n ? `${str.slice(0, n - 1)}…` : str;
}

/**
 * `fob-email threads list` — conversations in a folder, newest activity first.
 * @param {any} argv
 * @param {any} [mbox] injected client (tests); defaults to `clientFor(argv)`.
 */
export async function listThreadsHandler(argv, mbox) {
  const client = mbox ?? clientFor(argv);
  try {
    const threads = await client.threads.list({ folder: argv.folder, limit: argv.limit });
    if (argv.json) {
      console.log(JSON.stringify(threads, null, 2));
      return;
    }
    if (threads.length === 0) {
      console.log('(no threads)');
      return;
    }
    const rows = threads.map((t) => [
      String(t.latest?.id ?? ''),
      String(t.count),
      truncate(t.subject, 50),
      formatDate(t.latest?.date),
    ]);
    console.log(formatTable(['LATEST', 'MSGS', 'SUBJECT', 'DATE'], rows, { align: ['left', 'right', 'left', 'left'] }));
  } finally {
    await client.close();
  }
}
