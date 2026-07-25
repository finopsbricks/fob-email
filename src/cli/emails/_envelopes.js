// @ts-check
/**
 * Shared envelope-list presentation for `emails list` and `emails search` — the
 * column set and the human-table / `--json` output, defined once.
 */
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
 * Emit an envelope array: raw JSON under `--json`, else a human table (or a
 * `(no messages)` note). Windowing hints go to stderr so pipes stay clean.
 * @param {any[]} data
 * @param {any} argv
 */
export function emitEnvelopes(data, argv) {
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
  if (argv.limit != null && data.length >= argv.limit) {
    console.error(`(showing ${data.length}; raise --limit for more)`);
  }
}
