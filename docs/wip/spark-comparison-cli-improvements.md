# `fob-email` vs `spark` — Comparison & Improvement Backlog

## Status: EVALUATION — brainstorm for review; nothing scheduled. Pick items to promote into their own WIP.

A side-by-side of `fob-email` (this repo) and the `spark` CLI, scoped to the **objects `fob-email`
already implements** — `emails`, `threads`, `folders`, `drafts`, and `config accounts` — plus the
cross-cutting concerns of **search** and **speed**. Calendar, contacts, teams, meetings, templates,
and delegation are deliberately out of scope (not email-native; excluded in the
[resource-based-cli-alignment WIP](./resource-based-cli-alignment.md)).

The trigger: identical commands feel instant on `spark` and slow on `fob-email`. This doc explains
*why* (architecture, not tuning), then lays out a **menu of improvements** in tiers so we can pick
what's worth the cost — the goal is to sharpen our CLI, **not** to become a Spark clone.

---

## The One-Sentence Difference

**`spark` reads from a local mirror; `fob-email` reads from the live server.**

- `spark` is a thin **IPC client** (`/usr/local/bin/spark` → `SparklyRemote` inside *Spark Desktop.app*).
  The desktop app runs a **background sync daemon** that mirrors every account into local SQLite and
  keeps it current. The CLI never touches the network — it queries a local DB and returns in
  milliseconds. It **cannot run without the GUI app** (the skill itself says: no sandbox, container,
  CI, or headless session — "ask the user to launch Spark Desktop").
- `fob-email` is **stateless**: every command does a fresh `connect → TLS → login → SEARCH →
  fetch loop → logout`. Correct and dependency-free, but it pays the full round-trip tax on every
  invocation.

Neither is strictly "better" — they optimize for different worlds. Spark optimizes for an
always-on interactive desktop. `fob-email`'s target is **fin-ops automation** (workers, cron,
headless CI), where "requires a running desktop GUI" is a non-starter. That framing should govern
every decision below: **we want Spark's speed without sacrificing headless operability.**

---

## Architecture, side by side

| Dimension | `spark` | `fob-email` |
|---|---|---|
| Data source | Local SQLite mirror of all accounts | Live IMAP/SMTP, per command |
| State | Persistent daemon + ~700 MB local store (284 K msgs, 247 K convos, 18 K contacts here) | None — nothing cached between calls |
| Latency | ~instant (local read) | Connect + TLS + login + N round-trips, every time |
| Incremental sync | Per-folder `MODSEQ` (CONDSTORE), `UidNext`, `UidValidity`; Gmail `historyId`; Graph `deltaLink` | N/A — no sync; refetches from scratch |
| Message id | Stable local integer `pk` (survives across sessions, cross-folder) | **Per-folder IMAP UID** — unstable on `UIDVALIDITY` change, folder-scoped, needs `--folder` + stale-id guard |
| Search | Hybrid **keyword (FTS5) + semantic (embeddings)**, cross-account | IMAP `SEARCH` only — keyword/header/date, single folder, single account |
| Cross-account | **Unified Inbox** across all accounts, one query | One `--account` per invocation; no unification |
| Threads | **Materialized** `conversations` + `threadSummary` tables (pre-aggregated counts) | Reconstructed **live** every call (fetch a window, group in memory) |
| Runs headless / in CI | **No** — needs the desktop app | **Yes** — pure Node, no GUI, importable as a library |
| Transparency | Closed app; CLI is an opaque remote | Open, layered, `@ts-check`'d, importable `fobEmail(account)` |
| Filter syntax | One Gmail-style DSL string (`from: is:unread newer_than:7d has:attachment`) | Separate flags (`--from`, `--subject`, `--since`, `--unread`) |

### What Spark's local store buys it (and how)

Inspecting `~/Library/Application Support/Spark Desktop/core-data/`:

- **Separated stores by concern:** `messages.sqlite` (core), `threadSummary.sqlite`,
  `search_fts5.sqlite` (**FTS5 + `messageEmbeddings`/`attachmentEmbeddings`** → hybrid semantic
  search), `smart.sqlite` (AI categories), `contactsDictionary`, `calendarsapi`.
- **Denormalized/precomputed message columns** — no parsing on read: `shortBody` (snippet),
  `messageFromDomain`, `category` + `categoryByHeaders`, `unseen`, `starred`,
  `inInbox`/`inSent`/`inDrafts`, `numberOfFileAttachments`, `hasNewSender`, `listUnsubscribeURL`,
  `imapThreadId`, `gmailMessageId`.
- **Materialized conversation aggregates** — `conversations` carries `totalMessages`,
  `unseenMessages`, `totalInbox`, `lastMessageDate`, … so a thread list is a single indexed read,
  never a reconstruction.
- **Incremental sync bookkeeping per folder** — `imapLastSyncModSequenceValue`,
  `imapLastSyncUidNext`, `imapLastSyncUidValidity`, `gmailHistoryId`, `graphDeltaLink`. It fetches
  **deltas**, not the world.

### What `fob-email` does that Spark can't

Worth stating plainly so we don't regress it while chasing speed:

- **Headless / embeddable.** Runs in a worker, cron job, or CI with only Node + credentials. Spark
  physically cannot (it's a remote into a desktop process). For fin-ops automation this is the whole
  game.
- **One shared resource layer for CLI *and* library.** `fobEmail(account)` is importable; the CLI
  is just a presentation skin over it. Spark's logic is locked inside the app.
- **Transparent and typed.** Functional engine factories, `@ts-check` typedefs, a clean
  engine → transport `ctx` → resources → CLI layering. Easy to reason about and extend.
- **Zero background footprint.** No daemon, no 700 MB store, no "is the app running?" dependency.

---

## Why `fob-email` is slow — the concrete root causes

Not mysteries; they're visible in `src/engine/imap.js`:

1. **N+1 envelope fetch.** `fetchEnvelopes()` runs one `SEARCH`, then loops
   `client.fetchOne(uid, …)` **once per message** (`src/engine/imap.js:282`). Listing 50 emails =
   50 sequential fetch round-trips, on top of connect + TLS + login. imapflow can stream a whole UID
   range in **one** `fetch()` call — this alone is a large win and needs **no local store**.
2. **Cold connection every command.** Each invocation re-does the TCP + TLS handshake + `LOGIN`.
   The library reuses one session within a process, but the CLI is one-shot, so nothing is amortized
   across commands.
3. **Live thread reconstruction.** `resolveThread` (reconstruct path) fetches **up to 500 messages
   one at a time** to rebuild one conversation (`src/engine/imap.js:203`); `listThreads`
   over-samples `limit × 4` and fetches each (`:168`). Spark just reads a materialized row.
4. **No result reuse.** Re-running the same `emails search` refetches everything — there's no cache
   keyed by folder + `UIDVALIDITY` to serve unchanged messages instantly.

---

## Object-by-object comparison

### `emails`
- **Listing/filtering.** Spark: one composable DSL (`--filter "from:x is:unread newer_than:7d
  has:attachment category:priority"`), cross-account, instant. `fob-email`: discrete flags
  (`--from/--subject/--since/--unread`), single folder, live. **Gaps:** no `to:`/`cc:`, no relative
  dates (`newer_than:7d`), no `has:attachment`/`is:starred` filters, no categories, no unified inbox.
- **Ids.** Spark's stable `pk` vs our per-folder UID (the `--folder` requirement + stale-id errors
  are pure UID-model tax a local store would erase).
- **Actions.** We have `mark`/`move`/`delete`/`download`/`send`. Spark's `action` verb is broader
  (pin, snooze, archive, reminder, unsubscribe, mark-spam) — most are just flag/move ops we *could*
  add cheaply; some (snooze, reminder) need local state.
- **Snippets.** Spark shows `shortBody` in listings for free (precomputed). We'd need to fetch a
  body part — only cheap with a cache.

### `threads`
- Spark reads materialized `conversations`/`threadSummary` (pre-aggregated counts, `lastMessageDate`).
  We reconstruct live every call (expensive; see root cause #3). A local store is the natural fix —
  materialize thread membership at sync time, keyed by `imapThreadId`/Gmail thrid or reconstructed
  once.

### `folders`
- Closest to parity. Spark shows per-folder **message + unread counts** cheaply (cached in
  `folders.imapMessageCount`/`imapMessageUnseenCount`); ours lists paths/special-use. Adding counts
  live is an extra `STATUS` per folder (N round-trips) — cheap with a cache, noticeable without.
- We have full CRUD (create/rename/delete); Spark leans on labels/actions. This is a `fob-email`
  strength for an FDE filing receipts (`folders create Invoices/2026`).

### `drafts`
- Rough parity on lifecycle. `fob-email`: append-to-Drafts + delete-old-on-edit + send-via-SMTP —
  clean and headless. Spark adds `--reply-to`/`--forward` (threading a reply) and markdown→HTML
  bodies. **Cheap wins for us:** `--reply-to`/`--forward` (set `In-Reply-To`/`References` from an
  existing message) and optional markdown rendering.

### `config accounts`
- Different by design and both fine. Spark inherits accounts from the desktop app (nothing to
  configure). `fob-email` owns credentials via profiles + a cached capabilities probe
  (provider/threadStrategy/special folders) — the right model for a standalone tool. **No change
  needed**; this is a `fob-email` strength.

### `search` (cross-cutting)
- The starkest gap. Spark: hybrid keyword + **semantic** (embeddings), cross-account, returns bodies
  ranked by relevance. `fob-email`: IMAP `SEARCH`, keyword/header/date, one folder, one account, no
  ranking. Semantic parity needs embeddings over a local store (heavy). **Keyword FTS across
  folders/accounts** is the reachable middle if we build a cache.

---

## Improvement menu (tiered by cost)

Grouped so we can pick a stopping point. **Tier 0 needs no local store** and should probably ship
regardless. Tiers 1–2 are the "sync like Spark" question — deliberately optional and staged.

### Tier 0 — Speed & ergonomics, **no local store** (highest value / lowest risk)
- [ ] **Batch the envelope fetch.** Replace the per-UID `fetchOne` loop with one ranged
  `client.fetch(range, {...})` stream. Likely the single biggest latency win; pure engine change,
  behavior-preserving. *(root cause #1)*
- [ ] **Batch thread reconstruction** the same way (one ranged fetch of the window instead of
  per-UID), and cap/paginate the 500-message reconstruct window. *(root cause #3)*
- [ ] **Gmail-style filter DSL.** A small parser mapping `from: to: cc: subject: before: after:
  newer_than: older_than: has:attachment is:unread/starred` → IMAP `SEARCH` criteria, accepted as
  one `--filter` string (keep existing flags as sugar). Ergonomic parity with Spark; independent of
  sync. Note `category:`/semantic stay out (need local classification).
- [ ] **Draft `--reply-to` / `--forward`** (thread a reply via `In-Reply-To`/`References`); optional
  markdown→HTML body. Cheap, high-utility for automation.
- [ ] **Folder counts** (`STATUS` per folder) behind a flag, so `folders list` can show
  total/unread like Spark without always paying for it.

### Tier 1 — Optional local **cache** (opt-in, keeps statelessness as default)
The pragmatic middle: a SQLite envelope cache that makes reads instant *when present*, refreshes
incrementally, and is never required (headless callers can still go live).
- [ ] **`fob-email sync [--account] [--folder]`** → populate a local SQLite (mirror Spark's split:
  a `messages`/envelopes table keyed by `(account, folder, uidValidity, uid)` + a `sync_state`
  cursor row). Reads (`emails list/search`, `threads list`) serve from cache; `--live` bypasses.
- [ ] **Incremental refresh** using what IMAP already gives us — `UIDVALIDITY` + `UIDNEXT` to fetch
  only new UIDs, and **CONDSTORE `MODSEQ`** (imapflow supports it) to pull only changed flags. This
  is exactly Spark's `imapLastSyncUidNext`/`ModSequenceValue` bookkeeping, scaled down.
- [ ] **Precompute-on-sync** the fields that cost us on read: snippet (`shortBody`),
  `fromDomain`, `hasAttachment`, flags. Denormalize like Spark's `messages` table.
- [ ] **Stable ids from the cache** — expose a stable local id (or messageId/thrid) instead of
  leaking per-folder UIDs; the `--folder`/stale-id friction disappears for cached reads.
- [ ] **FTS5 keyword search** over cached subjects/bodies → cross-folder, ranked, instant. (Semantic
  embeddings explicitly deferred — see Tier 2.)
- [ ] **Materialized thread summaries** in the cache (membership + counts + `lastMessageDate`),
  killing live reconstruction for listed threads.

### Tier 2 — Full Spark-style sync (only if usage justifies it)
- [ ] **Unified cross-account inbox** — aggregate all profiles in one store; `emails list Inbox`
  spans accounts. Powerful, but only meaningful once multi-account is a real workflow.
- [ ] **Background/daemon or IDLE refresh** to keep the cache warm (vs. on-demand `sync`). Careful:
  a daemon starts to reintroduce the very "always-running process" dependency that makes `fob-email`
  attractive vs. Spark. Prefer on-demand/cron-driven sync over a resident daemon.
- [ ] **Semantic search** (embeddings over the local store). Heaviest lift, biggest infra
  (embedding model + vector index); revisit only with a concrete FDE demand.

---

## Recommendation (for the review)

1. **Do Tier 0 now, regardless of the sync decision.** The batched fetch + DSL are most of the
   perceived speed/ergonomic gap at a fraction of the cost and risk, and they don't compromise the
   headless-first design. Root cause #1 is likely the dominant latency term.
2. **Treat Tier 1 as a genuine fork to decide deliberately.** A local cache is the real "be like
   Spark" step. It's worth it *if* interactive/repeat use is common; it's overhead we don't want if
   `fob-email` stays mostly one-shot automation. Keep it **opt-in** and **never required** so
   workers/CI keep working live.
3. **Hold Tier 2 until a workflow demands it.** Unified inbox, daemons, and semantic search are
   Spark's interactive-desktop strengths — high cost, and a daemon partly forfeits our headless
   edge. Don't build them speculatively.

**Guiding principle:** adopt Spark's *data-locality* wins where they pay off, but never at the cost
of running headless. Spark is fast because it's a desktop app you must keep open; `fob-email`'s
reason to exist is that it isn't.

## Open Questions
- Is `fob-email` mostly **one-shot automation** (workers/cron) or also **interactive** at the
  terminal? This decides whether Tier 1's cache earns its keep.
- Multi-account: is a **unified inbox** a real need, or is per-account access sufficient?
- If we cache, where does the store live and what's the freshness contract (explicit `sync` vs.
  auto-refresh-if-stale)? A stale cache silently serving old mail is a correctness footgun for
  fin-ops.
- Do downstream workers need **stable ids** across runs? (Strong argument for a cache even ignoring
  speed.)

## Related Files
- `src/engine/imap.js` — N+1 fetch loop (`:282`), live thread reconstruction (`:168`, `:203`); the
  Tier-0 batching target.
- `src/engine/transport.js` — the `ctx` seam a cache layer would slot behind.
- `src/resources/emails.js`, `threads.js` — where cached vs. live reads would branch.
- `src/cli/emails/list.js` / `search.js` — where a `--filter` DSL parser would land.
- `docs/wip/resource-based-cli-alignment.md` — the object-model derivation (also mined from Spark).

## Related Notes
- Spark local stores: `~/Library/Application Support/Spark Desktop/core-data/*.sqlite`
- `spark` skill: `~/.claude/commands/use-spark/SKILL.md` (full command surface)
- [CLI Output Formatting](/Users/alex/ec2code/alex/engineering-standards/cli/output-formatting.md),
  [Command Grammar](/Users/alex/ec2code/alex/engineering-standards/cli/command-grammar.md)
</content>
</invoke>
