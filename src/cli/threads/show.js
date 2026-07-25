// @ts-check
import { clientFor } from '../_helpers.js';
import { formatTable, formatDate, formatSection } from '../../utils/format.js';

/** @param {any} a */
function addrCell(a) {
  return a ? a.addr ?? a.name ?? '' : '';
}

/**
 * `fob-email threads show <id>` — the full conversation containing a message,
 * oldest→newest.
 * @param {any} argv
 * @param {any} [mbox] injected client (tests); defaults to `clientFor(argv)`.
 */
export async function showThreadHandler(argv, mbox) {
  const client = mbox ?? clientFor(argv);
  try {
    const thread = await client.threads.show(Number(argv.id), { folder: argv.folder });
    if (argv.json) {
      console.log(JSON.stringify(thread, null, 2));
      return;
    }
    const messages = thread.messages ?? [];
    console.log(formatSection(`Thread ${thread.id} (${messages.length} message${messages.length === 1 ? '' : 's'})`));
    if (messages.length === 0) {
      console.log('(no messages)');
      return;
    }
    const rows = messages.map((m) => [String(m.id), addrCell(m.from), m.subject ?? '', formatDate(m.date)]);
    console.log(formatTable(['ID', 'FROM', 'SUBJECT', 'DATE'], rows));
  } finally {
    await client.close();
  }
}
