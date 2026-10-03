import { mkdirSync, chmodSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';

import { SCHEMA_SQL, SCHEMA_VERSION } from './schema.js';
import { storePath } from './path.js';
import { TROUBLESHOOTING_DOCS_URL } from '../links.js';

/**
 * `node:sqlite` is loaded through `createRequire`, not `import`.
 *
 * Being experimental, it is absent from `module.builtinModules` — the list
 * bundlers and test runners consult to recognise core modules. Under Jest's ESM
 * mode a dynamic `import('node:sqlite')` is handed to the VM loader, which does
 * not know it is built in and tries to read it as a *file* (ENOENT). Going
 * through `createRequire` reaches the real runtime resolver in every host, so
 * the store is testable without a Jest-specific shim leaking into src/.
 *
 * Revisit once `node:sqlite` stabilises and appears in `builtinModules`.
 */
const require_ = createRequire(import.meta.url);

/**
 * The local sync mirror — the only place that talks SQLite.
 *
 * `openStore()` is a functional factory in the same shape as engine/imap.js
 * `connectSession` and engine/smtp.js `connectMailer` (D5): the handle lives in a
 * closure variable and the returned object is a flat bag of ops. Callers close it.
 *
 * Two decisions govern everything here:
 *   D7 — data flows server → local only. Nothing in this module pushes, queues,
 *        or defers a write to the server; rows are a mirror of what the server
 *        already said, never a pending intention.
 *   D8 — the mirror is a local file, not a service. It holds envelope metadata
 *        (subjects, addresses, correspondence patterns), so it is user-private
 *        data and the file is created 0600 like config.yml.
 *
 * Backed by `node:sqlite` (unflagged from Node 22.13, hence the engines floor). It is flagged
 * experimental upstream and prints a process warning unless the host suppresses
 * it; `isAvailable()` lets callers fail with a useful message instead of a
 * module-load crash on an older runtime.
 */

/** @typedef {{ account: string, folder: string }} FolderRef */

/**
 * Is a SQLite driver present on this runtime? `sync` is the only feature that
 * needs one — every live path works without it, so this is a capability check,
 * not a startup assertion.
 */
export function isAvailable() {
  try {
    require_('node:sqlite');
    return true;
  } catch {
    return false;
  }
}

/**
 * Open (creating if absent) the mirror for this machine.
 *
 * @param {{ path?: string }} [opts] `path` overrides the default location —
 *   tests pass a temp file; production reads FOB_EMAIL_CONFIG_DIR via storePath().
 */
export function openStore({ path } = {}) {
  const file = path ?? storePath();

  let sqlite;
  try {
    sqlite = require_('node:sqlite');
  } catch {
    throw new Error(
      `Local sync needs Node.js 22.13 or later for its built-in SQLite (this is ${process.version}). ` +
        'Upgrade Node.js, or use the live (non-cached) commands. ' +
        `See ${TROUBLESHOOTING_DOCS_URL}#local-sync-requires-sqlite`,
    );
  }

  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new sqlite.DatabaseSync(file);

  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(SCHEMA_SQL);
  applyVersion(db);

  // Envelope metadata is as sensitive as the credentials beside it; match
  // config.yml's mode. Best-effort — a filesystem without POSIX modes is not a
  // reason to refuse to sync.
  if (file !== ':memory:') {
    try {
      chmodSync(file, 0o600);
    } catch {
      /* non-POSIX filesystem */
    }
  }

  const stmt = (sql) => db.prepare(sql);

  // -- prepared once, reused for every row ------------------------------------
  const selectFolder = stmt('SELECT * FROM folders WHERE account = ? AND path = ?');
  const upsertFolderRow = stmt(`
    INSERT INTO folders (account, path, uid_validity, uid_next, highest_modseq, last_synced_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (account, path) DO UPDATE SET
      uid_validity   = excluded.uid_validity,
      uid_next       = excluded.uid_next,
      highest_modseq = excluded.highest_modseq,
      last_synced_at = excluded.last_synced_at
  `);
  const upsertMessageRow = stmt(`
    INSERT INTO messages (
      account, folder, uid, uid_validity, message_id, thread_id, refs,
      from_name, from_addr, to_name, to_addr, subject, date, flags, has_attachment
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (account, folder, uid_validity, uid) DO UPDATE SET
      message_id     = excluded.message_id,
      thread_id      = excluded.thread_id,
      refs           = excluded.refs,
      from_name      = excluded.from_name,
      from_addr      = excluded.from_addr,
      to_name        = excluded.to_name,
      to_addr        = excluded.to_addr,
      subject        = excluded.subject,
      date           = excluded.date,
      flags          = excluded.flags,
      has_attachment = excluded.has_attachment
  `);
  const updateFlagsRow = stmt(`
    UPDATE messages SET flags = ?
    WHERE account = ? AND folder = ? AND uid_validity = ? AND uid = ?
  `);
  const deleteFolderMessages = stmt('DELETE FROM messages WHERE account = ? AND folder = ?');
  const deleteFolderRow = stmt('DELETE FROM folders WHERE account = ? AND path = ?');
  const countMessages = stmt(
    'SELECT COUNT(*) AS n FROM messages WHERE account = ? AND folder = ?',
  );
  const selectMessages = stmt(`
    SELECT * FROM messages
    WHERE account = ? AND folder = ?
    ORDER BY date DESC, uid DESC
    LIMIT ?
  `);
  const selectUids = stmt(
    'SELECT uid FROM messages WHERE account = ? AND folder = ? AND uid_validity = ?',
  );
  const selectAllFolders = stmt('SELECT * FROM folders ORDER BY account, path');

  return {
    /** The file this store is backed by (`:memory:` in tests). */
    file,

    /** The sync cursors for one folder, or null if it was never synced. */
    getFolder: ({ account, folder }) => toFolder(selectFolder.get(account, folder)),

    /** Every synced folder across every account — what `sync status` renders. */
    listFolders: () => selectAllFolders.all().map(toFolder),

    /**
     * Write a folder's cursors. Callers normally go through `syncFolder()` so the
     * cursor advances in the same transaction as the rows it describes.
     */
    putFolder: ({ account, folder, uidValidity, uidNext, highestModseq, lastSyncedAt }) => {
      upsertFolderRow.run(
        account,
        folder,
        uidValidity ?? null,
        uidNext ?? null,
        highestModseq == null ? null : String(highestModseq),
        lastSyncedAt ?? null,
      );
    },

    /** Envelopes for a folder, newest first — the shape `emails list` renders. */
    listMessages: ({ account, folder, limit = 50 }) =>
      selectMessages.all(account, folder, limit).map(toEnvelope),

    /**
     * Cached search — the local answer to `emails list`/`search`.
     *
     * Filtering happens in SQL rather than over a fetched page so `limit` means
     * "N matches" and not "N rows, some of which match". `unseen` reads the JSON
     * flags column with a LIKE, which is exact enough here: IMAP flag names are
     * backslash-prefixed atoms, so `"\\Seen"` cannot collide with a keyword.
     */
    searchMessages: ({ account, folder, limit = 50, unseen = false, from, subject, since } = {}) => {
      const where = ['account = ?', 'folder = ?'];
      const args = [account, folder];
      if (unseen) where.push(`flags NOT LIKE '%"\\\\Seen"%'`);
      if (from) {
        where.push('(LOWER(COALESCE(from_addr, \'\')) LIKE ? OR LOWER(COALESCE(from_name, \'\')) LIKE ?)');
        args.push(`%${String(from).toLowerCase()}%`, `%${String(from).toLowerCase()}%`);
      }
      if (subject) {
        where.push("LOWER(COALESCE(subject, '')) LIKE ?");
        args.push(`%${String(subject).toLowerCase()}%`);
      }
      if (since) {
        where.push('date >= ?');
        args.push(String(since));
      }
      const sql =
        `SELECT * FROM messages WHERE ${where.join(' AND ')} ORDER BY date DESC, uid DESC LIMIT ?`;
      return db.prepare(sql).all(...args, limit).map(toEnvelope);
    },

    /** Mirrored uids for a folder under one uidValidity (vanished-row reconciliation). */
    uidsIn: ({ account, folder, uidValidity }) =>
      selectUids.all(account, folder, uidValidity).map((r) => Number(r.uid)),

    /** How many messages are mirrored for a folder. */
    countMessages: ({ account, folder }) => Number(countMessages.get(account, folder)?.n ?? 0),

    /**
     * Apply one folder's sync result **atomically**: optionally purge, upsert the
     * envelopes, delete vanished uids, and advance the cursor — all in a single
     * transaction.
     *
     * This atomicity is the correctness backbone of the whole mirror. If the
     * cursor could advance without its rows, an interrupted sync would skip that
     * uid range *forever* and nothing would ever report the gap — a silent data
     * loss far worse than staleness. Per D7 an interrupted sync is otherwise
     * safe: the worst case is stale reads, never a wrong server mutation.
     *
     * @param {object} input
     * @param {string} input.account
     * @param {string} input.folder
     * @param {object[]} [input.messages] envelopes to upsert
     * @param {Array<{id: number, flags: string[]}>} [input.flagChanges] flag-only
     *   updates (the CONDSTORE delta path — no envelope refetch). Applied inside
     *   the same transaction so a delta can never land without its cursor.
     * @param {number[]} [input.vanished] uids to delete (gone server-side)
     * @param {boolean} [input.purge] drop every existing row first (UIDVALIDITY roll / --full)
     * @param {object} input.cursor `{ uidValidity, uidNext, highestModseq, lastSyncedAt }`
     */
    syncFolder: ({ account, folder, messages = [], flagChanges = [], vanished = [], purge = false, cursor }) => {
      db.exec('BEGIN IMMEDIATE');
      try {
        if (purge) deleteFolderMessages.run(account, folder);

        for (const m of messages) {
          upsertMessageRow.run(
            account,
            folder,
            Number(m.id),
            Number(cursor.uidValidity),
            m.messageId ?? null,
            m.threadId ?? null,
            m.refs ? JSON.stringify(m.refs) : null,
            m.from?.name ?? null,
            m.from?.addr ?? null,
            m.to?.name ?? null,
            m.to?.addr ?? null,
            m.subject ?? null,
            m.date ?? null,
            JSON.stringify(m.flags ?? []),
            m.hasAttachment ? 1 : 0,
          );
        }

        // Flag deltas touch only `flags`, leaving envelope fields alone — a
        // message whose \Seen changed has not otherwise changed, and an upsert
        // here would need a full envelope we deliberately did not fetch.
        for (const ch of flagChanges) {
          updateFlagsRow.run(
            JSON.stringify(ch.flags ?? []),
            account,
            folder,
            Number(cursor.uidValidity),
            Number(ch.id),
          );
        }

        if (vanished.length) {
          // Bounded IN-list: uids are numbers we just coerced, so this cannot
          // carry injection, and one statement beats N round-trips.
          const list = vanished.map((u) => Number(u)).join(',');
          db.exec(
            `DELETE FROM messages WHERE account = '${esc(account)}' AND folder = '${esc(folder)}' ` +
              `AND uid_validity = ${Number(cursor.uidValidity)} AND uid IN (${list})`,
          );
        }

        upsertFolderRow.run(
          account,
          folder,
          cursor.uidValidity ?? null,
          cursor.uidNext ?? null,
          cursor.highestModseq == null ? null : String(cursor.highestModseq),
          cursor.lastSyncedAt ?? null,
        );

        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },

    /** Drop a folder's mirror (rows + cursor), or a whole account's if no folder. */
    clear: ({ account, folder } = {}) => {
      db.exec('BEGIN IMMEDIATE');
      try {
        if (folder) {
          deleteFolderMessages.run(account, folder);
          deleteFolderRow.run(account, folder);
        } else if (account) {
          db.prepare('DELETE FROM messages WHERE account = ?').run(account);
          db.prepare('DELETE FROM folders WHERE account = ?').run(account);
        } else {
          db.exec('DELETE FROM messages');
          db.exec('DELETE FROM folders');
        }
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },

    close: () => {
      try {
        db.close();
      } catch {
        /* already closed */
      }
    },
  };
}

/**
 * Stamp the schema version, refusing a file written by a newer fob-email rather
 * than misreading it. Downgrades are the realistic hazard — an older binary
 * meeting a newer store — and a mirror is disposable, so the fix is `sync clear`.
 */
function applyVersion(db) {
  const found = Number(db.prepare('PRAGMA user_version').get()?.user_version ?? 0);
  if (found > SCHEMA_VERSION) {
    throw new Error(
      `Local sync store is version ${found}, newer than this fob-email understands ` +
        `(${SCHEMA_VERSION}). Upgrade fob-email, or run \`fob-email sync clear\` to rebuild it.`,
    );
  }
  if (found !== SCHEMA_VERSION) db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
}

/** Escape a single-quoted SQL literal (only used for the bounded uid delete). */
function esc(s) {
  return String(s).replace(/'/g, "''");
}

/** folders row → the cursor object the sync layer works with. */
function toFolder(row) {
  if (!row) return null;
  return {
    account: row.account,
    folder: row.path,
    uidValidity: row.uid_validity == null ? null : Number(row.uid_validity),
    uidNext: row.uid_next == null ? null : Number(row.uid_next),
    highestModseq: row.highest_modseq ?? null,
    lastSyncedAt: row.last_synced_at ?? null,
  };
}

/**
 * messages row → the same envelope shape engine/imap.js `toEnvelope` produces,
 * so a cached read is indistinguishable from a live one to every layer above.
 */
function toEnvelope(row) {
  return {
    id: Number(row.uid),
    messageId: row.message_id ?? null,
    from: row.from_addr || row.from_name ? { name: row.from_name ?? null, addr: row.from_addr ?? null } : null,
    to: row.to_addr || row.to_name ? { name: row.to_name ?? null, addr: row.to_addr ?? null } : null,
    subject: row.subject ?? '',
    date: row.date ?? null,
    flags: parseJsonArray(row.flags),
    hasAttachment: Boolean(row.has_attachment),
  };
}

function parseJsonArray(s) {
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
