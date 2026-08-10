# D8 — The sync store is local. No `email.finopsbricks.com`.

- **Status:** Accepted — 2026-08-10
- **Scope:** where the sync mirror lives (local SQLite vs. a hosted FinOpsBricks service)
- **Builds on:** [D7 — Sync is unidirectional](./0001-unidirectional-sync.md)
- **Governs:** [Manual sync WIP](../wip/manual-sync-local-store.md)

## Decision

The sync mirror is a **local SQLite store on the user's machine**. `fob-email` continues to talk
**directly to IMAP/SMTP** with credentials that never leave the machine.

We are **not** building `email.finopsbricks.com` as a sync/cache service that the CLI queries.

## Context — why the question came up

Every other CLI in the family is a thin client over a hosted service: `fob-stm` →
`statements.finopsbricks.com`, `cli-fobs` → per-app origins, `fob-zb` → its API. `fob-email` is the
odd one out, talking a protocol directly. The natural-looking symmetry fix is a service that syncs
mailboxes and answers CLI queries, reducing the CLI to "query the service."

## Why not

**The family pattern is about systems of record, not about CLIs preferring services.** Per the
[App Inventory](/handbooks/platform-handbook/architecture/system-of-record-app-inventory.md),
`statements`/`billing`/`recordings` are SOR apps that *own* their domain data. Those CLIs are thin
because the service **is** the product — the data must live somewhere multi-tenant, and the CLI is
one front-end among several.

**Email inverts that.** The system of record for a mailbox is Gmail/Fastmail/Exchange. FinOpsBricks
does not own that data and never will. An `email.finopsbricks.com` would not be an SOR; it would be
**a cache in front of someone else's SOR** — a different category of thing, and the source of every
cost below.

- **Credential posture gets materially worse.** IMAP passwords currently sit in
  `~/.fob/fob-email/config.yml`, mode 0600, on the user's own machine. A sync service must hold
  those credentials (or OAuth refresh tokens) **server-side**, because a server has to hold the IMAP
  connection. That is a system holding the keys to employees' mailboxes: a breach of `statements`
  leaks accounting data; a breach of `email` leaks the ability to **read and send as our users**. It
  would demand encryption at rest, key rotation, an incident story, and likely per-provider OAuth.
- **It relocates the daemon we deliberately rejected, and adds ops.** The
  [spark-comparison WIP](../wip/spark-comparison-cli-improvements.md) concluded a resident
  always-on process forfeits the headless edge. A service doesn't remove that process — it moves it
  server-side and adds hosting, monitoring, and on-call. It *must* be always-on: a service that
  syncs only when someone runs a command is just a slower local cache.
- **Latency moves the wrong way.** The goal was removing round-trips. A remote service reintroduces
  one per read — faster than N IMAP round-trips, slower than local SQLite — and makes reads
  impossible offline, which a local store handles fine.
- **It breaks the reason `fob-email` exists.** "Runs in a worker, cron job, or CI with only Node +
  credentials" is the stated value. A service-backed CLI cannot run without the service — trading
  "requires Spark Desktop running" for "requires our service up," which is precisely the
  disqualifying flaw we identified in Spark.
- **Multi-tenancy work for proxied data.** Per
  [API Key Scoping](/handbooks/platform-handbook/security/api-key-scoping.md), SOR apps each carry
  their own key store and do not federate. `email` would need its own org model, key minting, and
  RBAC — real platform work — to serve what is ultimately a proxy of the user's own mailbox.

## The case for a service, and why it doesn't apply yet

Stated fairly, because it is not weak — and because it is what would reopen this:

- Workers/orchestrator processes needing mailbox access (e.g. pulling invoices from vendor email)
  would be better served by one shared service than by every worker holding IMAP credentials and
  syncing its own store. **This is the strongest argument.**
- A cache shared across laptop, CI, and workers — sync once, query anywhere.
- Server-side work the CLI can't do well: embeddings for semantic search, long-running classification.

Every one of these is about **the platform needing email data**, not about **the CLI needing to be
fast**. Confirmed with the user (2026-08-10): **there is no platform need for email data right
now.** Absent that need, the service is speculative infrastructure carrying a serious security
surface.

## Consequences

- Credentials stay on the user's machine; no server ever holds mailbox access.
- `fob-email` keeps working headless, offline (for cached reads), and with no service dependency.
- We own no additional uptime, hosting, or on-call surface.
- No cross-machine cache sharing: each machine syncs its own mirror. Accepted.
- `fob-email` remains structurally unlike its siblings — direct protocol client, not a service
  client. That asymmetry is **correct**, and this record exists so it isn't "fixed" later by
  someone noticing the inconsistency without the reasoning.

## Not foreclosed

The local store **costs nothing** if a service is later justified. The `src/engine/transport.js`
`ctx` seam that a SQLite store slots behind is the same seam an HTTP client slots behind — that is
exactly what `fob-stm/src/http.js` is. Swapping or adding a remote backend later is a transport
implementation, not a redesign.

If platform demand for email data appears, the preferred shape is **not** a CLI-facing cache
service. It is **ingestion into `fetch.finopsbricks.com`**, which the App Inventory already
describes as "data ingestion pipelines — worker/orchestrator-adjacent" — driven by orchestrator
processes, not by a human at a terminal. `fob-email` would stay local and personal regardless.

These are two products with different consumers, auth models, and uptime requirements. A service
attempting to be both a CLI cache and a platform ingestion point would serve neither well.

## Related

- `docs/decisions/0001-unidirectional-sync.md` — D7, sync direction
- `docs/wip/manual-sync-local-store.md` — the implementation this unblocks
- `docs/wip/spark-comparison-cli-improvements.md` — the headless-vs-daemon argument
- `src/engine/transport.js` — the seam that keeps a future service cheap
- `src/config.js` — `CONFIG_DIR`, where credentials and the store both live
