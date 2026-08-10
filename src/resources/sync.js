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
     *   4. Flags on already-mirrored messages: a CONDSTORE `changedSince` delta
     *      when the server negotiated it and we hold a modseq cursor; otherwise
     *      re-read the window, because a stale \Seen that never corrects itself
     *      is worse than a slower sync.
     *   5. Vanished messages: CONDSTORE reports modifications, not deletions, so
     *      ask the server which uids still exist and delete the difference —
     *      bounded to the range actually asked about.
     *   6. Commit rows, flag deltas, and cursor in one transaction.
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
      const uidValidity = result.uidValidity ?? status.uidValidity;
      const ref = { account, folder, uidValidity };

      // -- flags -------------------------------------------------------------
      // New messages arrived with fresh flags; the question is only whether
      // *already-mirrored* messages had theirs changed. On a fresh pass every row
      // is being rewritten anyway, so there is nothing to reconcile.
      let flagChanges = [];
      let flagMode = fresh ? 'full' : 'none';
      /** @type {number[]|null} a uid census obtained as a by-product of a re-read */
      let censusUids = null;

      if (!fresh && stored?.highestModseq) {
        const delta = await ctx.fetchFlagChanges({ folder, sinceModseq: stored.highestModseq });
        if (delta.supported) {
          // Only rows we actually mirror; a changed uid outside the mirror is
          // not ours to record.
          const known = new Set(store.uidsIn(ref));
          flagChanges = delta.changes.filter((c) => known.has(Number(c.id)));
          flagMode = 'condstore';
        }
      }

      // Without a usable modseq cursor, stored flags cannot be trusted at all —
      // re-read the window rather than let a stale \Seen persist indefinitely.
      // Correctness over cleverness; CONDSTORE is the optimisation, not the rule.
      if (!fresh && flagMode === 'none') {
        const refetch = await ctx.fetchForSync({ folder, sinceUid: null, limit: null });
        flagChanges = refetch.data.map((m) => ({ id: m.id, flags: m.flags }));
        flagMode = 'refetch';
        // A whole-folder re-read is also an authoritative uid census, so reuse
        // it below instead of paying for a second scan.
        censusUids = refetch.uids;
      }

      // -- vanished ----------------------------------------------------------
      // CONDSTORE reports *modified* messages and says nothing about deleted
      // ones (that is QRESYNC), so the only reliable answer is to ask which uids
      // still exist and diff. On an incremental pass the fetch window starts at
      // the cursor and therefore proves nothing about older rows — hence an
      // explicit census. It is one SEARCH returning integers, not a refetch.
      let vanished = [];
      if (fresh) {
        vanished = vanishedIn(store, ref, result.uids, result.windowFrom);
      } else if (censusUids) {
        vanished = vanishedIn(store, ref, censusUids, null);
      } else {
        const census = await ctx.listUids({ folder });
        vanished = vanishedIn(store, ref, census.uids, null);
      }

      store.syncFolder({
        account,
        folder,
        messages: result.data,
        flagChanges,
        vanished,
        purge: fresh,
        cursor: {
          uidValidity,
          uidNext: status.uidNext,
          // Only store a modseq we could actually act on. Recording one while
          // the delta path is unavailable would make the *next* sync assume a
          // window it never reconciled, silently skipping flag changes.
          highestModseq:
            flagMode === 'condstore' || (fresh && (await ctx.hasCondstore()))
              ? (result.highestModseq ?? status.highestModseq ?? null)
              : (stored?.highestModseq ?? null),
          lastSyncedAt: now(),
        },
      });

      return {
        account,
        folder,
        mode: fresh ? (rolled ? 'reset' : 'full') : 'incremental',
        flagMode,
        fetched: result.data.length,
        flagsUpdated: flagChanges.length,
        vanished: vanished.length,
        total: store.countMessages({ account, folder }),
        uidValidity,
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
