# D7 — Sync is unidirectional (server → local). No offline writes.

- **Status:** Accepted — 2026-08-10
- **Scope:** the local sync store (the [spark-comparison WIP](../wip/spark-comparison-cli-improvements.md) "Tier 1" fork)
- **Supersedes/refines:** nothing; extends the decision series D1–D6 in
  [resource-based-cli-alignment](../wip/resource-based-cli-alignment.md)

## Decision

**Mail data flows in exactly one direction: server → local.** The local store is a *mirror*, never
an authority. `sync` pulls messages and their state down; it never pushes anything up.

Every mutation — `emails mark`, `emails move`, `emails delete`, folder CRUD, draft
append/delete, and SMTP `send` — continues to go **straight to the server**, exactly as it does
today. The local row is reconciled only *after* the server confirms, either by write-through or by
marking the folder dirty for the next pull.

**There is no local write queue, no pending-ops table, and no conflict resolution — by design.**

A corollary, accepted deliberately: **without a network connection you cannot mutate mail.**
`mark`/`move`/`delete`/`send` fail with a connection error offline, just as they do now. Only
*reads* are served locally.

## Why

- **Offline is not a scenario for this tool.** `fob-email`'s target is fin-ops automation — workers,
  cron, headless CI — which is online by definition. Offline writes are the *entire* benefit a
  bidirectional design buys; every other win (speed, stable ids, instant listings, local search)
  comes from the read mirror alone and needs no queue.
- **One direction means conflicts cannot arise.** With the server as sole authority there is no
  "local disagrees with remote" state to detect, reconcile, or explain to a user. This was the
  decisive factor: the model is chosen for the conflicts it makes *impossible*, not merely for the
  ones it handles well.
- **A write queue would be keyed on the one id we already document as unstable.** Per **D4**, a
  message id is a per-folder IMAP UID, scoped to a folder and invalidated on `UIDVALIDITY` change.
  `move` is worse than unstable — *executing* it destroys the message's identity (new UID at the
  destination, gone from the source). A queued `move` replayed later against a rolled folder is
  precisely the "acting on the wrong message" failure D4's stale-id guard exists to prevent.
  Building a deferred-write queue on UIDs would reintroduce that hazard at a layer where it is
  harder to detect.
- **A write is either done on the server or it errored.** There is never a state where the CLI
  reports "moved" while the server disagrees. For finance work — where a stale cache silently
  serving old mail is already flagged as a correctness footgun — adding *write*-side divergence on
  top is the wrong trade.
- **Emails are immutable anyway, which shrinks the surface.** IMAP messages are fixed blobs; the
  only mutable state is **flags** and **folder membership**. There is no "edit an email" operation
  to sync (`drafts edit` is already append-new + delete-old for this reason). `send` is SMTP — a
  different protocol and server — and touches local mailbox state only insofar as the provider's
  copy in Sent shows up as an ordinary new message on the next pull.

## Consequences

- The store needs no `pending_ops` table, no replay/idempotency logic, no conflict-resolution
  policy, and no "half-applied push" recovery path.
- `sync` can be interrupted or killed at any point with no risk to the mailbox: the worst outcome is
  a stale local read, never a wrong server-side mutation.
- After a `MOVE`, the message's new destination UID is unknown locally until observed, so
  write-through cannot always fully update the row from local knowledge — marking the folder dirty
  and re-pulling is the simpler reconciliation and is preferred where the two differ.
- Offline mutation is unavailable. Accepted explicitly.

## Not foreclosed

This is the strictly cheaper option and it keeps the expensive one reachable. If a genuine offline
demand appears, a queue is **additive** — a table plus a push phase over the same mirror, not a
redesign of the store.

Should that day come, the preferred increment is **queue only the safe ops**: `mark` (flag changes
are idempotent and don't touch message identity, so replay is harmless) while keeping `move` and
`delete` online-only — most of the offline value at a fraction of the correctness risk. Do not
build it speculatively.

## Still open (freshness, not direction)

This decision settles **direction only**. The freshness contract for cached reads is a separate,
still-open question from the spark-comparison WIP — explicit-`sync`-only vs. TTL auto-refresh vs. a
cheap per-read `STATUS` validity check (`UIDNEXT`/`UIDVALIDITY`/`HIGHESTMODSEQ`). So are store
scope (envelopes only vs. bodies/snippets vs. materialized threads) and whether cached reads expose
a stable local id in place of the per-folder UID.

## Related

- `docs/wip/spark-comparison-cli-improvements.md` — Tier 1/2 menu; the fork this resolves
- `docs/wip/resource-based-cli-alignment.md` — D4 (UID id model), D6 (self-describing profiles)
- `src/engine/transport.js` — the `ctx` seam a cache layer slots behind
- `src/engine/imap.js` — the write ops that stay pass-through (`setFlag`, `move`, `expunge`)
