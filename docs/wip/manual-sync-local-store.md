# Manual Sync — a user-triggered local mirror

## Status: DRAFT — plan for review; not started. Phases below are the proposed order.

Add a **user-triggered** `fob-email sync` that mirrors envelopes from the server into a local SQLite
store, so reads (`emails list/search`, `threads list`, `folders list`) can be served locally and
instantly instead of paying a full `connect → TLS → login → SEARCH → N fetches → logout` on every
invocation.

This is the **Tier 1** fork from the
[spark-comparison backlog](./spark-comparison-cli-improvements.md), scoped down to its smallest
useful form: **manual only**. No daemon, no IDLE, no background refresh, no auto-sync-on-read.
The user decides when to sync, by running a command.

**Two decisions are already settled and constrain everything below:**

- [**D7 — Sync is unidirectional**](../decisions/0001-unidirectional-sync.md): data flows server →
  local only. The store is a mirror, never an authority. Nothing here queues, defers, or pushes a
  write.
- [**D8 — The store is local**](../decisions/0002-local-store-not-a-service.md): SQLite on the
  user's machine, not a hosted `email.finopsbricks.com`. Credentials never leave the machine and
  the CLI keeps working with no service dependency.

---

## Problem Statement

**Current state.** Every command is stateless (see
[spark-comparison root causes](./spark-comparison-cli-improvements.md)): a cold connection per
invocation, an N+1 envelope fetch loop (`src/engine/imap.js:282` — one `fetchOne` *per message*),
and live thread reconstruction that can fetch up to 500 messages one at a time
(`src/engine/imap.js:203`). Nothing is reused between calls. Listing the same inbox twice costs
exactly twice as much.

**Desired outcome.** `fob-email sync` populates a local mirror; subsequent reads are local and
near-instant. The stateless live path remains fully intact and reachable, so headless workers and CI
keep working with no store at all.

**Non-goals (explicitly out of scope for this WIP):**
- Background sync, a daemon, IDLE, or auto-refresh — *manual trigger only* (this is the whole point).
- Any local→server write path (D7).
- Bodies, snippets, FTS5, or semantic search (deferred; see **Deliberately Deferred**).
- Cross-account unified inbox (Tier 2).

---

## Decisions to Confirm Before Building

These are the open questions from the spark-comparison WIP, now forced by this work. **Marked
`PROPOSED` = my recommendation, not yet confirmed.** Each is called out at the phase that depends
on it.

### S1 — Freshness contract: `--cached` is opt-in; live stays the default `PROPOSED`
The footgun a local mirror introduces is *silently serving stale mail*, which is a correctness
problem for fin-ops. Three candidate defaults were considered:

| Option | Behavior | Verdict |
|---|---|---|
| **Cached opt-in** | Reads stay live unless `--cached` is passed | **PROPOSED** |
| Cached default + `--live` escape | Reads serve local; `--live` bypasses | Rejected for v1 — silently changes existing behavior for every current caller |
| Auto-validate per read | One `STATUS` round-trip, serve local if unchanged | Deferred — good, but it's an *automatic* refresh and this WIP is "manual only" |

Rationale for opt-in: it is the only option that **cannot break an existing caller**. Every current
command keeps its exact behavior; the mirror is purely additive. It also keeps the promise honest —
`--cached` says "I accept data as of the last sync," and `sync status` shows how old that is.

The auto-validating read (a single `STATUS` comparing `uidNext`/`uidValidity`/`highestModseq`, then
a local read if unchanged) is the natural **v2** default once the store has proven itself. Noting it
here so the schema below carries the columns it needs — it costs nothing now and avoids a migration.

### S2 — Store scope: envelopes + flags only `PROPOSED`
Store what `emails list`/`search` and `threads list` render: id, uid, uidValidity, messageId,
from/to, subject, date, flags, hasAttachment, plus the reference headers threads need. **No bodies,
no snippets** in v1 — bodies dominate store size and initial sync time, and `emails show` on a live
fetch is already acceptable (it's one message, not N). Deferring bodies also defers the FTS5
question entirely.

### S3 — Ids: cached reads keep exposing the IMAP UID `PROPOSED`
Tempting to issue a stable local id (D4's per-folder-UID friction is real "UID-model tax"). But
introducing a *second* id namespace while the live path still speaks UIDs means every command must
disambiguate which kind of id it got, and a cached id could be handed to a live command that can't
resolve it. **v1 keeps UIDs everywhere**, so cached and live reads are interchangeable and D4's
contract is untouched. The store still carries a stable `id` primary key internally, so exposing it
later is additive — but it stays internal for now.

### S4 — SQLite driver: `node:sqlite` ✅ **CONFIRMED (2026-08-10)**
Settled as proposed: **`node:sqlite`, zero new dependencies, engines floor raised to `>=22.5.0`.**

Sequelize was evaluated and rejected on a hard technical constraint: **its SQLite dialect requires
the native `sqlite3` npm package and cannot drive `node:sqlite`** (`sqlite3` is a listed optional
peer dep; no adapter exists). Adopting it would have meant a native module — node-gyp/prebuilds —
for every user including those who never sync, plus ~14 transitive deps, and would have made the
engines bump pointless since `sqlite3` runs on Node 18. The family's `architecture/database/`
standards that describe Sequelize are written for the Postgres/Next.js apps (`DataTypes.JSONB`,
`schema: 'auth'`, `process.env.DB_APP`, CommonJS) and don't transfer to an ESM CLI with no server.

The store therefore follows **this repo's own idiom** instead — a functional factory
(`openStore()`) in the same shape as `connectSession`/`connectMailer` per **D5** — with
hand-written SQL. Original text follows.

---

### S4 (original proposal) — SQLite driver: `node:sqlite`
Verified on this machine (Node v22.21.0): `node:sqlite` is present and exposes
`DatabaseSync`/`StatementSync`. **It emits `ExperimentalWarning: SQLite is an experimental feature`
on stderr**, which would pollute the diagnostics channel — suppressible per-process, but worth
knowing.

Trade-off: `node:sqlite` adds **zero dependencies** (a real virtue for a tool whose selling point is
"pure Node + credentials, runs anywhere"), but is experimental and requires Node ≥22.5 — while
`package.json` currently declares `"node": ">=18.0.0"`. Adopting it means **either** raising the
engines floor **or** making the store an optional capability that degrades gracefully on Node 18.
The alternative, `better-sqlite3`, is stable and works on Node 18 but is a **native module** —
compilation, prebuilds, and a much heavier install for every user including those who never sync.

**Recommendation:** `node:sqlite`, with the store treated as an *optional capability* — if the
runtime lacks it, `sync` errors with a clear message and every live path keeps working untouched.
That preserves the Node-18 floor for the 95% of usage that never syncs. **Needs confirmation** —
this is the one choice here with real distribution consequences.

### S5 — Store location: `~/.fob/fob-email/sync.db` `PROPOSED`
Alongside `config.yml` in the existing `CONFIG_DIR` (`src/config.js:32`), so the family keeps one
backup/chmod/delete surface. Honors the existing `FOB_EMAIL_CONFIG_DIR` override, which tests
already use. Mode `0600` — envelopes contain subjects, addresses, and correspondence metadata, so
this is user-private data even without bodies.

---

## Design

### Layering — the store slots behind the existing `ctx` seam

The `src/engine/transport.js` `ctx` is already the seam resources bind to, and resources hold no
protocol knowledge (`src/resources/emails.js` is pure delegation). That is exactly the right
insertion point: **nothing in `src/resources/` or `src/cli/emails/` needs to change** to make reads
cache-aware.

```
  src/cli/sync/*             ← new: the `sync` command tree (run, status, clear)
  src/resources/sync.js      ← new: buildSync(ctx) — the sync verbs, defined once (CLI + library)
  src/store/                 ← new: SQLite. schema.js, open.js, messages.js, state.js
  src/engine/transport.js    ← unchanged seam; gains sync-supporting ops
  src/engine/imap.js         ← gains: statusOf(folder), fetchEnvelopesSince(...) [batched]
```

The store is **its own layer, not part of the engine**: the engine speaks IMAP, the store speaks
SQLite, and `resources/sync.js` is the only place the two meet. This keeps `src/engine/imap.js`
free of persistence concerns and keeps the store independently testable with no network.

### Schema (v1)

```sql
CREATE TABLE folders (
  account       TEXT NOT NULL,
  path          TEXT NOT NULL,
  uid_validity  INTEGER,          -- D4: a change here invalidates every uid below
  uid_next      INTEGER,          -- incremental cursor: fetch uids >= this next time
  highest_modseq TEXT,            -- BigInt-as-TEXT; CONDSTORE flag-change cursor (may be NULL)
  last_synced_at TEXT,            -- ISO 8601; what `sync status` reports
  PRIMARY KEY (account, path)
);

CREATE TABLE messages (
  id            INTEGER PRIMARY KEY,   -- stable local id (internal in v1 — see S3)
  account       TEXT NOT NULL,
  folder        TEXT NOT NULL,
  uid           INTEGER NOT NULL,
  uid_validity  INTEGER NOT NULL,
  message_id    TEXT,
  thread_id     TEXT,                  -- server thread id when the profile is `thread-id` (D6)
  refs          TEXT,                  -- JSON array: References + In-Reply-To, for `reconstruct`
  from_name     TEXT, from_addr TEXT,
  to_name       TEXT, to_addr   TEXT,
  subject       TEXT,
  date          TEXT,                  -- ISO 8601
  flags         TEXT NOT NULL,         -- JSON array
  has_attachment INTEGER NOT NULL,     -- 0/1, precomputed from bodyStructure
  UNIQUE (account, folder, uid_validity, uid)
);

CREATE INDEX messages_listing ON messages (account, folder, date DESC);
CREATE INDEX messages_thread  ON messages (account, thread_id);
```

Notes:
- `(account, folder, uid_validity, uid)` is the natural key and encodes **D4** directly: when a
  folder's `UIDVALIDITY` rolls, old rows simply no longer match and are dropped wholesale.
- `has_attachment` is precomputed at sync time from `bodyStructure` (the existing `hasAttachment()`
  helper), so a cached listing never parses structure — the Spark denormalization trick.
- `thread_id`/`refs` are stored so **thread listing can be served locally later** without a second
  sync format change. Materializing thread *summaries* is deferred, but the raw inputs are captured
  now so that work needs no re-sync.
- `highest_modseq` is `TEXT` because modseq is a `BigInt` in imapflow and SQLite integers are signed
  64-bit; TEXT round-trips it losslessly and comparisons are done in JS.

### The sync algorithm

Per `(account, folder)`:

1. **`STATUS`** the folder for `uidValidity`, `uidNext`, `messages`, and `highestModseq`
   (verified available — `imapflow` `status()` supports all four; `highestModseq` only when the
   server advertises CONDSTORE).
2. **Compare `uidValidity` with the stored row.** Mismatch (or no row) → **full resync**: delete
   every message row for that `(account, folder)` and treat the stored cursor as empty. This is the
   D4 stale-id rule applied at the store level.
3. **Fetch new messages** — `uid` range `storedUidNext:*`, in **one ranged `client.fetch()`**, not
   the current per-uid `fetchOne` loop. Upsert rows.
4. **Fetch changed flags** — if the server supports CONDSTORE *and* a `highest_modseq` is stored,
   one fetch with `changedSince: storedModseq` returning only messages whose flags moved (verified:
   `imapflow` supports `changedSince` on `fetch`). Without CONDSTORE, v1 **re-fetches flags for the
   synced window** rather than pretending they're current — correctness over cleverness, and
   `sync status` should say which mode was used.
5. **Detect vanished messages** — messages deleted server-side since the last sync. CONDSTORE alone
   does *not* report these (QRESYNC does). v1 handles it by reconciling the uid set for the synced
   window against stored rows and deleting the difference. **This is the step most likely to be
   subtly wrong and needs explicit tests.**
6. **Record the new cursors** (`uid_next`, `highest_modseq`, `last_synced_at`) in one transaction
   with the row writes, so an interrupted sync never advances a cursor past data it didn't store.

Step 6 is the correctness backbone: **cursor advancement and row writes must be atomic**, otherwise
a killed sync silently skips mail forever. Per D7 an interrupted sync is safe by construction — the
worst case is a stale read, never a wrong server mutation — but a *skipped range* would be a silent
data gap, which is worse than staleness because nothing reports it.

### Command surface

Following the family grammar (`fob-email <resource> <action>`, `src/cli/index.js`):

```
fob-email sync run     [--account <name>] [--folder <path>] [--all-folders] [--full]
fob-email sync status  [--account <name>] [--json]
fob-email sync clear   [--account <name>] [--folder <path>]
```

- `sync run` — the trigger. Default scope: **INBOX of the current account** (the conservative
  default; `--all-folders` opts into everything `listFolders()` returns). `--full` forces a resync
  from scratch, ignoring stored cursors — the escape hatch when a mirror is suspected wrong.
- `sync status` — per folder: last synced at, message count, whether CONDSTORE incremental is in
  use, and **how stale the mirror is**. This is what makes `--cached` an honest promise.
- `sync clear` — drop mirrored rows. The store is disposable by definition (it can always be
  rebuilt from the server), so deleting it must be a first-class, obviously-safe operation.

`sync` is a resource noun here, consistent with the grammar's "no exceptions" rule — `run`/`status`/
`clear` are its actions. It is not an email/thread/folder object, but neither is `config`, and the
same shape applies.

Reads gain `--cached` (S1): `emails list --cached` serves from the mirror and **errors clearly if
that folder was never synced**, rather than silently falling back to live (a silent fallback would
make `--cached` untrustworthy for the scripting case it exists to serve).

---

## Phases

Ordered so each lands independently, tests stay green, and the live path is never broken.

### Phase 0 — Batch the envelope fetch (prerequisite, standalone value) ✅ DONE
Replaced the per-uid `fetchOne` loops with a single ranged `client.fetch()` stream, via a shared
`fetchByUids()` helper. This is **Tier 0** from the spark-comparison doc and the likely dominant
latency term — worth shipping on its own merits, and sync depends on it (a sync fetching one message
per round-trip would be unusable).

**Landed:**
- `fetchByUids(c, uids, query)` — one FETCH for a whole uid set. Re-projects results through the
  requested uid order (the server streams in *its* order, not ours) and drops uids the server didn't
  return, so a message expunged between the SEARCH and the FETCH leaves no gap. Short-circuits on an
  empty set — `fetch()` with an empty range would otherwise resolve `1:*` and haul the whole mailbox.
- `fetchEnvelopes()` — now one SEARCH + one FETCH. Serves `emails list`, `emails search`, and
  `drafts list`. **50 messages: 50 round-trips → 1.**
- `fetchThreadNodes()` — same treatment. Scope was widened beyond the original plan because it is the
  identical fix on a worse path: `resolveThread` fetched **up to 500 messages one at a time**
  (`imap.js:203`), and `listThreads` over-samples `limit × 4`. Leaving it would have been a
  half-measure.
- `test/imap-fetch.test.js` — the engine had **no** direct coverage (existing tests mock at the
  resource/`ctx` seam), so passing tests proved only "nothing broke," not "batching works." Adds a
  fake imapflow client asserting round-trip count, requested-order preservation, expunged-uid
  handling, and empty-set short-circuit. Mutation-checked: breaking the re-projection fails 4 tests.
- `fetchByUids`/`fetchEnvelopes` are exported for that test; the four remaining `fetchOne` calls are
  genuine single-message fetches (full message, draft source, thread id) and correctly untouched.

Behavior-preserving: 75/75 tests pass (68 pre-existing, untouched), typecheck clean.

> **Incidental fix:** `npm test` was broken before this work — `jest-junit` was declared but two of
> its transitive deps were missing from `node_modules`, so the suite couldn't start. `npm install`
> restored them. No `package.json` change.

### Phase 1 — The store layer (no network) ✅ DONE
`src/store/` — schema, path resolution, and an `openStore()` factory. Zero IMAP, fully unit-tested
against `:memory:` and temp files.

**Landed:**
- `src/store/schema.js` — pure SQL text + `SCHEMA_VERSION`. Two tables as designed above.
- `src/store/path.js` — `~/.fob/fob-email/sync.db`, honouring `FOB_EMAIL_CONFIG_DIR`. Resolved
  **per call** (unlike `config.js`'s module-load `CONFIG_PATH`) so tests can redirect it after import.
- `src/store/index.js` — `openStore()`, a D5-style functional factory. Prepared statements built
  once; `syncFolder()` applies purge + upserts + vanished-deletes + cursor advance **in one
  transaction**; `clear()` at folder/account/whole-store granularity; `isAvailable()` as a capability
  check so `sync` can fail with a useful message instead of crashing on an old runtime.
- Cached envelopes are emitted in **exactly** the shape `engine/imap.js` `toEnvelope` produces, so a
  cached read is indistinguishable to every layer above — that is what will make Phase 4 a pure
  branch behind the `ctx` seam rather than a second rendering path.
- The store file is created `0600` like `config.yml`: envelope metadata (subjects, addresses,
  correspondence patterns) is user-private even without bodies.
- `test/store.test.js` — 18 tests. The load-bearing one is **"a failed syncFolder advances neither
  rows nor cursor"**: it poisons a message mid-transaction and asserts full rollback. Mutation-checked
  by swapping the `ROLLBACK` for a `COMMIT`, which fails exactly that test and nothing else.
- `package.json` engines → `>=22.5.0`.

> **`node:sqlite` is loaded via `createRequire`, not `import`.** Being experimental it is absent from
> `module.builtinModules`, so Jest's ESM loader doesn't recognise it as a core module, strips the
> `node:` prefix, and tries to read it as a *file* (ENOENT). `createRequire` reaches the real runtime
> resolver in every host, which keeps the fix in `src/` as one documented line instead of a
> Jest-specific resolver shim. Revisit when `node:sqlite` stabilises.

### Phase 2 — `sync run` for one folder ✅ DONE
`statusOf()` + `fetchForSync()` in the engine, `resources/sync.js`, and the full `sync` command tree.

**Landed:**
- `engine/imap.js` — `statusOf(folder)` (one `STATUS`: uidNext/uidValidity/messages/highestModseq,
  modseq stringified so it survives SQLite TEXT) and `fetchForSync({ folder, sinceUid, limit })`,
  which returns envelopes **plus the uid set the server reported for the searched window**. That uid
  set is what makes vanished-message reconciliation possible at all.
- `engine/transport.js` + `types/general/Transport.types.js` — both ops exposed on the seam. (The
  typecheck caught the missing type entries, which is exactly what that layer is for.)
- `resources/sync.js` — `buildSync(ctx, store)`, the only place the engine and store meet.
- `cli/sync/{index,run,status,clear}.js` + registration in `cli/index.js`.
- `index.js` — `fobEmail()` gains a lazy `sync` namespace; the store opens on first use so a client
  that never syncs never touches SQLite. Accounts passed as raw config objects are keyed by login
  address so two mailboxes can't share mirror rows.
- `test/sync.test.js` — 20 tests against a fake transport whose mailbox can be mutated between
  syncs, plus CLI handler coverage.

**Two behaviours were load-bearing enough to mutation-check** (both delete mail from the mirror when
wrong, and both were verified by breaking them and watching the right tests fail):
- **An incremental pass must not reconcile deletions.** Its search window starts at the stored
  cursor, so every older mirrored row is out of scope — treating them as "absent from the server"
  would wipe the mirror on *every* incremental sync. Removing the guard fails 3 tests.
- **A UIDVALIDITY roll must purge** (D4). Same uids, different mail; without the purge the mirror
  silently reinterprets stale ids against new messages. Removing it fails the reset test.

Two smaller traps worth recording:
- `uid N:*` always matches the highest existing uid **even when no uid is ≥ N**, so a naive
  incremental sync re-fetches one message on every poll. Filtered explicitly; covered by a test.
- A `--limit`ed first sync only asked about the newest N, so deletion reconciliation is bounded by
  `windowFrom` — otherwise the first capped sync would delete every older row it holds.

`sync run` reports its **mode** (`full` / `incremental` / `reset`) because the three mean very
different things to someone waiting on it, and a silent rebuild under the label "sync" would hide a
real server-side event. `reset` also warns on stderr.

- **Deferred as planned:** CONDSTORE flag deltas (Phase 3). This phase re-fetches the window rather
  than trusting stored flags — correct if slower. `highest_modseq` is deliberately stored as `null`:
  recording one now would let Phase 3 assume a delta window this phase never actually reconciled.

### Phase 3 — Incremental refinement ✅ DONE
CONDSTORE `changedSince` for flag deltas plus real vanished-message reconciliation. This is where
the store stops being "a cache that grows" and becomes a real mirror.

**Landed:**
- `hasCondstore()` reads `client.enabled`, the **post-`ENABLE`** set — what the server actually
  negotiated, not what `CAPABILITY` merely advertised. Only the former makes a modseq cursor
  trustworthy.
- `fetchFlagChanges({ folder, sinceModseq })` — one CONDSTORE fetch returning only touched messages.
  It reports `supported: false` rather than an empty list when CONDSTORE is absent, so the caller can
  never mistake "unsupported" for "nothing changed".
- `listUids({ folder })` — a bare `SEARCH ALL`, no FETCH. **CONDSTORE reports modifications and says
  nothing about deletions** (that is QRESYNC), so the only reliable way to find vanished mail is to
  ask which uids still exist and diff. One round-trip returning integers.
- `store.syncFolder()` gains `flagChanges`, applied **inside the same transaction** as rows and
  cursor, touching only the `flags` column — a message whose `\Seen` moved has not otherwise
  changed, and an upsert would need a full envelope we deliberately did not fetch.
- Three flag modes, reported as `flagMode`: `condstore` (delta), `refetch` (no CONDSTORE — re-read
  the folder), `full` (fresh pass, every row rewritten anyway). `sync run` labels the re-read case
  in its output, since it is the difference between a cheap and an expensive sync and is a property
  of the *server*, not of anything the user did.

**The load-bearing guard, mutation-checked:** a modseq cursor is stored **only when the delta path
was actually usable**. Recording one while flags came from a re-read would make the *next* sync
assume a delta window it never reconciled — silently skipping every flag change in between.
Removing that condition fails exactly the cursor test.

Phase 2's known gap is closed: an incremental pass now detects deletions below the cursor. The
non-CONDSTORE path reuses its whole-folder re-read as the uid census rather than paying for a second
scan.

### Phase 4 — `--cached` reads ✅ DONE
`emails list` and `emails search` gain `--cached`, served from the mirror. (`sync status` and
`sync clear` landed early, in Phase 2.)

**Landed:**
- `sync.read()` — the mirror's read verb. Synchronous, because SQLite is; the network-shaped
  `await` that every live path carries would be a lie here.
- `store.searchMessages()` filters **in SQL**, so `limit` means "N matches" rather than "N rows
  scanned, then filtered" — the latter would drop matches that exist and silently under-report.
  `unseen` matches on the quoted system flag so a user keyword like `NotSeenByMe` cannot be
  mistaken for `\Seen`.
- `toEnvelope(row)` emits exactly the shape `engine/imap.js` produces, so `emitEnvelopes()`,
  `--json`, and the `filter` pipe cannot tell a cached row from a live one. That equivalence is
  what makes `--cached` a flag rather than a second output format.
- Staleness prints to **stderr** (`(cached — synced 3h ago)`), never stdout, and is suppressed
  under `--json` — a mirror is only trustworthy when its age is visible at the point of use, but
  not at the cost of a pipe-clean stdout.
- `search --cached` **refuses `--query`** rather than quietly matching subject-only. The mirror
  holds envelopes, not bodies (S2); silently narrowing a full-text search returns fewer results
  than asked for with no indication anything was dropped.

**The load-bearing guard, mutation-checked:** `read()` throws — naming the exact `sync run` command
that fixes it — when the folder was never synced. Replacing that throw with a fallback to live
fails exactly two tests: the resource-level throw and the CLI-level "errors instead of falling back".
This is **S1** made real: `--cached` that quietly hit the network would be meaningless for the
scripting case the flag exists to serve.

### Phase 5 — Multi-folder + multi-account
`--all-folders`, and syncing several configured accounts in one run (`accountNames()` already
exists in `src/config.js:152`). Still strictly manual.

---

## Risks

- **Silent staleness.** The core hazard of any mirror. Mitigated by S1 (opt-in `--cached`), by
  `sync status` surfacing age prominently, and by refusing to serve unsynced folders.
- **Silent gaps from a partial sync.** Worse than staleness because nothing reports it. Mitigated by
  the atomic cursor+rows transaction (step 6) — the single most important invariant in this design.
- **Vanished messages** (step 5) — the easiest thing to get subtly wrong without QRESYNC, and it
  fails in the direction of showing mail that no longer exists. Needs dedicated tests.
- **`node:sqlite` experimental status** (S4) — API could shift; emits a stderr warning; forces the
  Node-18-floor question. The optional-capability framing contains the blast radius.
- **Store size growth.** Envelopes-only keeps this modest, but nothing prunes yet. `sync clear`
  is the manual answer for v1; retention policy is deferred.
- **Scope creep toward a daemon.** The spark-comparison doc warns that a resident daemon forfeits
  the headless edge that is `fob-email`'s reason to exist. Manual-only is a deliberate boundary,
  not a stepping stone.

## Deliberately Deferred

Captured so they aren't re-litigated mid-build: bodies/snippets, FTS5 keyword search, semantic
search, materialized thread summaries, stable public ids (S3), auto-validating reads (S1 v2),
cross-account unified inbox, retention/pruning, and any form of background or scheduled sync.

## Open Questions

- **S4 is the one blocking choice** — `node:sqlite` (zero deps, experimental, Node ≥22) vs.
  `better-sqlite3` (stable, native build) vs. optional-capability. This determines whether the
  `engines` floor moves, so it should be settled before Phase 1.
- Should `sync run` with no prior state sync the **whole folder** or only the last N messages? A
  first sync of a large mailbox could be very slow; a `--limit`/`--since` bound on the initial pull
  may be the humane default.
- Does `--cached` belong on `threads list` in v1, given thread summaries aren't materialized? (It
  can be served from `thread_id`/`refs` at read time, but that's reconstruction against the store
  rather than the network — faster, still not free.)
- Should `sync` participate in the family's `config accounts` refresh flow (i.e. does adding an
  account offer an initial sync), or stay entirely separate?

## Related Files

- `docs/decisions/0001-unidirectional-sync.md` — **D7**, the direction this builds on
- `docs/wip/spark-comparison-cli-improvements.md` — Tier 0/1/2 backlog; root-cause analysis
- `src/engine/imap.js` — `fetchEnvelopes` N+1 loop (`:282`); gains `statusOf`/`fetchEnvelopesSince`
- `src/engine/transport.js` — the `ctx` seam the store slots behind
- `src/resources/emails.js` — where cached vs. live branches (via `ctx`, no signature change)
- `src/config.js` — `CONFIG_DIR` (`:32`) for the store path; `accountNames()` (`:152`) for Phase 5
- `src/cli/index.js` — where the `sync` resource registers
