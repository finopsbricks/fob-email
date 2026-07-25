// @ts-check
import { clientFor } from '../_helpers.js';
import { buildColumnSelector } from '../utils/list.js';
import { formatTable, formatDate } from '../../utils/format.js';

/** Truncate a cell so wide subjects don't blow out the table. */
function truncate(s, n) {
  const str = s ?? '';
  return str.length > n ? `${str.slice(0, n - 1)}…` : str;
}

/** @param {any} a */
function addrCell(a) {
  return a ? a.addr ?? a.name ?? '' : '';
}

/** @type {Record<string, import('../utils/list.js').Column>} */
const COLUMNS = {
  id: { header: 'ID', align: 'left', render: (e) => String(e.id ?? ''), raw: (e) => e.id },
  from: { header: 'FROM', align: 'left', render: (e) => addrCell(e.from), raw: (e) => addrCell(e.from) || null },
  to: { header: 'TO', align: 'left', render: (e) => addrCell(e.to), raw: (e) => addrCell(e.to) || null },
  subject: { header: 'SUBJECT', align: 'left', render: (e) => truncate(e.subject, 50), raw: (e) => e.subject },
  date: { header: 'DATE', align: 'left', render: (e) => formatDate(e.date), raw: (e) => e.date },
  flags: { header: 'FLAGS', align: 'left', render: (e) => (e.flags || []).join(','), raw: (e) => e.flags },
  attach: { header: 'ATT', align: 'left', render: (e) => (e.hasAttachment ? '*' : ''), raw: (e) => e.hasAttachment },
};
const DEFAULT_FIELDS = ['id', 'from', 'subject', 'date'];
const PUBLIC_FIELDS = ['id', 'from', 'to', 'subject', 'date', 'flags', 'attach'];
const selector = buildColumnSelector({ columns: COLUMNS, defaultFields: DEFAULT_FIELDS, publicFields: PUBLIC_FIELDS });

/**
 * `fob-email emails list` — envelopes for a folder, newest first. Human table by
 * default; `--json` emits the raw envelope array (for scripting / the `filter` pipe).
 * @param {any} argv
 * @param {any} [mbox] injected client (tests); defaults to `clientFor(argv)`.
 */
export async function listEmailsHandler(argv, mbox) {
  const client = mbox ?? clientFor(argv);
  try {
    const { data } = await client.emails.list({
      folder: argv.folder,
      unseenOnly: argv.unseen,
      limit: argv.limit,
    });

    if (argv.json) {
      console.log(JSON.stringify(data, null, 2));
      return;
    }
    if (data.length === 0) {
      console.log('(no messages)');
      return;
    }

    const fields = selector.parseFields(argv.fields);
    console.log(
      formatTable(selector.headersFor(fields), selector.renderRows(data, fields), {
        align: selector.alignFor(fields),
      }),
    );
    if (data.length >= (argv.limit ?? 50)) {
      console.error(`(showing ${data.length}; raise --limit for more)`);
    }
  } finally {
    await client.close();
  }
}
