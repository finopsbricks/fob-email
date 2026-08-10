/**
 * The local mirror's schema — pure SQL text, no I/O.
 *
 * Two tables (D8: this is a local SQLite file, not a service):
 *
 *   folders   one row per (account, path) — the incremental sync cursors
 *   messages  the mirrored envelopes
 *
 * Column names are `snake_case` per the family's database standard. The rows are
 * a *mirror*, never an authority (D7) — anything here can be dropped and rebuilt
 * from the server, which is what makes `sync clear` safe and why nothing below
 * carries local-only state.
 */

/** Bumped only for a breaking shape change; `open()` refuses a newer file. */
export const SCHEMA_VERSION = 1;

/**
 * `(account, folder, uid_validity, uid)` is the natural key and encodes D4
 * directly: when a folder's UIDVALIDITY rolls, old rows simply stop matching and
 * are deleted wholesale rather than being silently reinterpreted against new ids.
 *
 * `highest_modseq` is TEXT because IMAP modseq is a 64-bit unsigned value that
 * imapflow surfaces as a BigInt — SQLite INTEGER is *signed* 64-bit, so TEXT is
 * what round-trips it losslessly. Comparisons happen in JS as BigInt.
 *
 * `has_attachment` is precomputed at sync time so a cached listing never parses
 * bodyStructure, and `refs`/`thread_id` are stored so thread grouping can be
 * served locally later without a re-sync.
 */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS folders (
  account        TEXT NOT NULL,
  path           TEXT NOT NULL,
  uid_validity   INTEGER,
  uid_next       INTEGER,
  highest_modseq TEXT,
  last_synced_at TEXT,
  PRIMARY KEY (account, path)
);

CREATE TABLE IF NOT EXISTS messages (
  id             INTEGER PRIMARY KEY,
  account        TEXT NOT NULL,
  folder         TEXT NOT NULL,
  uid            INTEGER NOT NULL,
  uid_validity   INTEGER NOT NULL,
  message_id     TEXT,
  thread_id      TEXT,
  refs           TEXT,
  from_name      TEXT,
  from_addr      TEXT,
  to_name        TEXT,
  to_addr        TEXT,
  subject        TEXT,
  date           TEXT,
  flags          TEXT NOT NULL,
  has_attachment INTEGER NOT NULL,
  UNIQUE (account, folder, uid_validity, uid)
);

CREATE INDEX IF NOT EXISTS messages_listing ON messages (account, folder, date DESC);
CREATE INDEX IF NOT EXISTS messages_thread  ON messages (account, thread_id);
`;
