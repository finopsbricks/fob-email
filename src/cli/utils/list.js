// @ts-check
/**
 * The column selector — shared machinery for `list`-style commands.
 *
 * Each list handler declares a `COLUMNS` map ({ header, align, render, raw }),
 * a default field list, and the public (selectable) field list. `buildColumnSelector`
 * turns those into `--fields` parsing/validation, table headers/alignment, and
 * row rendering — so every list gets the same `--fields`/`--format` vocabulary
 * and the same "unknown field" error, with no per-command table math.
 *
 * `render` produces the human/table cell (formatted, may truncate); `raw` yields
 * the untouched value for `--format csv|json`.
 *
 * @typedef {{ header: string, align?: 'left'|'right', render: (item: any) => string, raw?: (item: any) => any }} Column
 */

/**
 * @param {{ columns: Record<string, Column>, defaultFields: string[], publicFields: string[] }} config
 */
export function buildColumnSelector({ columns, defaultFields, publicFields }) {
  const known = new Set(publicFields);

  /** Parse a `--fields a,b,c` string; fall back to the defaults; validate each. */
  const parseFields = (/** @type {string|undefined} */ arg) => {
    if (!arg) return [...defaultFields];
    const fields = arg
      .split(',')
      .map((f) => f.trim())
      .filter(Boolean);
    const bad = fields.filter((f) => !known.has(f));
    if (bad.length) {
      throw new Error(
        `Unknown field(s): ${bad.join(', ')}. Available: ${publicFields.join(', ')}`,
      );
    }
    return fields;
  };

  const headersFor = (/** @type {string[]} */ fields) => fields.map((f) => columns[f].header);
  const alignFor = (/** @type {string[]} */ fields) => fields.map((f) => columns[f].align ?? 'left');
  const renderRows = (/** @type {any[]} */ items, /** @type {string[]} */ fields) =>
    items.map((item) => fields.map((f) => columns[f].render(item)));
  const rawRows = (/** @type {any[]} */ items, /** @type {string[]} */ fields) =>
    items.map((item) => fields.map((f) => (columns[f].raw ?? columns[f].render)(item)));

  return { parseFields, headersFor, alignFor, renderRows, rawRows, publicFields };
}
