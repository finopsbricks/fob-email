// @ts-check
/**
 * Shared formatting helpers for CLI output.
 * Humans read the default text; `--json` emits the raw payload. Data goes to
 * stdout; these helpers never write — the handler decides where the string lands.
 */

/**
 * Format an aligned `label: value` line.
 * @param {string} label
 * @param {any} value
 * @param {number} [labelWidth] pad the label to this width for column alignment
 * @returns {string}
 */
export function formatField(label, value, labelWidth = 0) {
  const shown = value == null || value === '' ? '—' : String(value);
  return `${`${label}:`.padEnd(labelWidth + 1)} ${shown}`;
}

/**
 * Format a table with dynamic column widths.
 * @param {string[]} headers - Column header names
 * @param {string[][]} rows - Array of row arrays (strings)
 * @param {{ align?: Array<'left'|'right'> }} [options] - Per-column alignment; defaults to all 'left'
 * @returns {string} Formatted table string
 */
export function formatTable(headers, rows, options = {}) {
  if (rows.length === 0) {
    return headers.join('  ') + '\n(none)';
  }

  const align = options.align ?? [];
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] || '').length)),
  );

  const pad = (/** @type {string} */ text, /** @type {number} */ width, /** @type {number} */ i) =>
    align[i] === 'right' ? text.padStart(width) : text.padEnd(width);

  const headerLine = headers.map((h, i) => pad(h, widths[i], i)).join('  ');
  const separator = '-'.repeat(headerLine.length);
  const dataLines = rows.map((row) =>
    row.map((cell, i) => pad(cell || '—', widths[i], i)).join('  '),
  );

  return [headerLine, separator, ...dataLines].join('\n');
}

/**
 * Format rows as RFC-4180 CSV (quote fields containing comma/quote/newline).
 * @param {string[]} headers
 * @param {Array<Array<any>>} rows
 * @returns {string}
 */
export function formatCsv(headers, rows) {
  const esc = (/** @type {any} */ v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers, ...rows].map((row) => row.map(esc).join(',')).join('\n');
}

/**
 * Format an ISO date as `YYYY-MM-DD HH:MM:SS` (local time). Empty → '—'.
 * @param {string|Date|null|undefined} iso
 * @returns {string}
 */
export function formatDate(iso) {
  if (!iso) return '—';
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const p = (/** @type {number} */ n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/**
 * Human-readable byte size (`4.2 KB`, `1.1 MB`). Used for attachment sizes.
 * @param {number|null|undefined} bytes
 * @returns {string}
 */
export function formatBytes(bytes) {
  if (bytes == null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let n = bytes / 1024;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${n.toFixed(1)} ${units[i]}`;
}

/**
 * A header line with a right-aligned status/id (e.g. a message or thread header).
 * @param {string} label
 * @param {string|number|null} [id]
 * @param {string|null} [status]
 * @returns {string}
 */
export function formatHeader(label, id, status) {
  const left = id != null ? `${label}  #${id}` : label;
  return status ? `${left}   [${status}]` : left;
}

/**
 * A section divider: `--- Title ---`.
 * @param {string} title
 * @returns {string}
 */
export function formatSection(title) {
  return `--- ${title} ---`;
}

/**
 * A "showing N of M" hint for a windowed list. Returns '' when nothing is hidden.
 * @param {{ shown: number, total?: number|null, hint?: string }} ctx
 * @returns {string}
 */
export function formatPaginationHint({ shown, total, hint } = /** @type {any} */ ({})) {
  if (total == null || total <= shown) return '';
  return `(showing ${shown} of ${total}${hint ? ` — ${hint}` : ''})`;
}
