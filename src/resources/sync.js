// @ts-check
/**
 * The `sync` resource — the only place the IMAP engine and the local store meet.
 *
 * Everything above this layer sees either protocol ops (`ctx`) or rows
 * (`store`), never both. `buildSync(ctx, store)` binds the two into the verbs
 * the CLI and library share, exactly as `buildEmails(ctx)` does for emails.
 *
 * Governed by two decisions:
 *   D7 — server → local only. Nothing here writes to the server. A sync that is
 *        interrupted, killed, or fails mid-flight can leave the mirror stale but
 *        can never leave the mailbox wrong.
 *   D8 — the mirror is a local file, so "sync" means "pull," never "push."
 *
 * Sync is **manual**: these verbs run when a user invokes `fob-email sync`.
 * There is no daemon, no IDLE, and no auto-refresh on read.
 */

/**
 * @typedef {import('../types/general/index.js').Transport} Transport
 */

/**
 * @typedef {Object} SyncApi
 * @property {(opts?: object) => Promise<object>} run
 * @property {(opts?: object) => Promise<object[]>} status
 * @property {(opts?: object) => Promise<object>} clear
 */

/**
 * @param {Transport} ctx protocol ops (engine/transport.js)
 * @param {any} store the local mirror (store/index.js `openStore()`)
 * @param {{ account?: string, now?: () => string }} [opts]
 *   `account` names the rows this client owns; `now` is injectable so tests get
 *   deterministic timestamps.
 * @returns {SyncApi}
 */
export function buildSync(ctx, store, { account = 'default', now = () => new Date().toISOString() } = {}) {
  return {
    /**
     * Pull one folder into the mirror and return what changed.
     *
     * The algorithm, per the WIP:
     *   1. STATUS the folder (one round-trip) for uidValidity/uidNext/modseq.
     *   2. If UIDVALIDITY moved (or nothing is stored), purge and resync — D4's
     *      stale-id rule applied to the store: every mirrored uid was issued
     *      under the old value and is now meaningless, so reinterpreting it
     *      against fresh ids would silently point at the wrong messages.
     *   3. Fetch new messages from the stored cursor (or the whole folder, capped
     *      by `limit`, on a first pass).
     *   4. Flags: Phase 2 re-fetches the window rather than pretending stored
     *      flags are current. CONDSTORE `changedSince` lands in Phase 3.
     *   5. Vanished messages: diff the searched window's uid set against the
     *      mirrored uids **in that same window** and delete the difference.
     *   6. Commit rows + cursor in one transaction (store.syncFolder).
     *
     * @param {{ folder?: string, full?: boolean, limit?: number|null }} [opts]
     */
    run: async ({ folder = 'INBOX', full = false, limit = null } = {}) => {
      const status = await ctx.statusOf(folder);
      const stored = store.getFolder({ account, folder });

      // A UIDVALIDITY change invalidates every stored id for this folder (D4).
      const rolled =
        stored?.uidValidity != null &&
        status.uidValidity != null &&
        Number(stored.uidValidity) !== Number(status.uidValidity);
      const fresh = full || !stored || rolled;

      // Incremental only when we trust the stored cursor. `uidNext` is the
      // server's *next* uid, so it is exactly the low bound for "new since".
      const sinceUid = fresh ? null : (stored?.uidNext ?? null);

      const result = await ctx.fetchForSync({ folder, sinceUid, limit: fresh ? limit : null });

      // Reconcile deletions only across the range we actually asked about. On an
      // incremental pass that range starts at the old cursor, so older mirrored
      // rows are simply out of scope and must not be treated as vanished — that
      // would delete the entire mirror on every incremental sync.
      const vanished = fresh
        ? vanishedIn(store, { account, folder, uidValidity: result.uidValidity }, result.uids, result.windowFrom)
        : [];

      store.syncFolder({
        account,
        folder,
        messages: result.data,
        vanished,
        purge: fresh,
        cursor: {
          uidValidity: result.uidValidity ?? status.uidValidity,
          uidNext: status.uidNext,
          // Phase 2 does not consume modseq deltas, so storing one now would let
          // Phase 3 assume a window it never actually reconciled. Left null
          // until the CONDSTORE path exists to honour it.
          highestModseq: null,
          lastSyncedAt: now(),
        },
      });

      return {
        account,
        folder,
        mode: fresh ? (rolled ? 'reset' : 'full') : 'incremental',
        fetched: result.data.length,
        vanished: vanished.length,
        total: store.countMessages({ account, folder }),
        uidValidity: result.uidValidity ?? status.uidValidity,
        uidNext: status.uidNext,
        syncedAt: now(),
      };
    },

    /** Every mirrored folder with its freshness — what `sync status` renders. */
    status: async ({ folder } = {}) =>
      store
        .listFolders()
        .filter((f) => f.account === account && (!folder || f.folder === folder))
        .map((f) => ({
          ...f,
          messages: store.countMessages({ account: f.account, folder: f.folder }),
        })),

    /** Drop mirrored rows. The mirror is disposable — it rebuilds from the server. */
    clear: async ({ folder } = {}) => {
      const before = folder
        ? store.countMessages({ account, folder })
        : store.listFolders().filter((f) => f.account === account).reduce((n, f) => n + store.countMessages(f), 0);
      store.clear(folder ? { account, folder } : { account });
      return { account, folder: folder ?? null, cleared: before };
    },
  };
}

/**
 * Uids mirrored in the searched window but absent from the server's answer.
 *
 * Scoped to `windowFrom` because a capped first sync only asked about the newest
 * N messages: rows below that bound were never in scope and are not evidence of
 * deletion. Without this bound a `--limit`ed sync would delete every older row
 * it still holds.
 */
function vanishedIn(store, ref, serverUids, windowFrom) {
  const present = new Set(serverUids.map(Number));
  return store
    .uidsIn(ref)
    .filter((uid) => (windowFrom == null || uid >= windowFrom) && !present.has(uid));
}
