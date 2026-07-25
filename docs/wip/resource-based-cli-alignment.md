# Adopt the Resource-Based CLI Pattern for `fob-email`

## Status: NOT STARTED

Reshape `fob-email` from a flat, protocol-flavoured command set (`list`, `read`, `filter`) into a
**resource/action grammar over user-facing objects** — `emails`, `threads`, `folders`, `drafts`,
and `config accounts` — backed by a single **shared resource layer** that the CLI and the importable
library both call. A finance FDE automating fin-ops thinks in *emails, conversations, attachments, and
folders* — invoices to pull, receipts to file, a vendor thread to trace — not in IMAP UIDs, envelopes,
and `bodyStructure`. This refactor makes the CLI speak that language and brings us onto the same
standard as `fob-stm`.

---

> **Reference implementation:** `cli/fob-stm` (the `src/resources/` + `fobStm(creds)` factory +
> `src/cli/<resource>/` handler tree). Its WIP, `cli/fob-stm/docs/wip/cli-lib-unification.md`, is the
> playbook this doc adapts for a **protocol** tool (IMAP/SMTP) rather than an HTTP API.
>
> **Governing standards:** `alex/engineering-standards/cli/` — `command-grammar.md`,
> `project-structure.md`, `output-formatting.md`, `auth-patterns.md` (**Pattern C — protocol
> credentials**), `error-handling.md`, `config-and-secrets.md`, `testing.md`.

## Problem Statement

**Current state.** `fob-email` is a 2-in-1 repo (importable client in `src/index.js` + CLI in
`src/cli/`) but it deviates from the family standard on three axes:

1. **Not resource/action-shaped.** Commands are flat verbs bolted to IMAP operations —
   `fob-email list`, `fob-email read <id>`, `fob-email filter`. There is no `emails` / `folders`
   resource, no CRUD grammar, and the vocabulary leaks the protocol (`read` collides with
   "mark as read"; a "message UID" is exposed as the id). The standard's shape is
   `fob-<tool> <resource> <action> [target] [options]` with **no exceptions**.
2. **No shared resource layer, no written types.** IMAP/SMTP knowledge lives directly in
   `src/engine/imap.js` (`Session`) and the handlers call it ad hoc. There is no `src/resources/`
   (the single place object operations are defined once for both CLI and library) and no
   `src/types/` (`@ts-check`'d typedefs). `fob-stm` proved that only *declared* typedefs get real
   checking under `checkJs` — we have neither the layer nor the types.
3. **Output is JSON-first, protocol-first.** `src/cli/index.js` markets "JSON on stdout" as the
   default. The standard is the inverse: **human-readable by default, raw JSON under `--json`**, data
   on stdout / diagnostics on stderr, using the shared `format.js` helpers (tables, field alignment,
   `formatDate`, `formatBytes`, pagination hints).

**Desired outcome.** A CLI a fin-ops FDE reads like plain English —
`fob-email emails list --unread --from billing`, `emails download 1423 --attachments -o ./invoices/`
— backed by one DRY `src/resources/` layer so the CLI and `fobEmail(account)` library can never
drift, fully `@ts-check`'d, with human-first output and `--json` as the scripting escape hatch.

## Decisions Locked (2026-07-26)

Confirmed with the user before drafting:

1. **Resource noun is `emails`** (not `messages`). Everyday word for the audience; "not a CLI for an
   email expert." The full object set (derived from the spark CLI — see **Object Model** below) is
   `emails`, `threads`, `folders`, `drafts`, plus `config accounts` (see #6) for credentials.
2. **Human-readable output by default; `--json` on every read command.** This **flips today's
   JSON-by-default** — a breaking change for any worker/pipeline that consumed raw JSON from the old
   flat commands. Tracked as an intentional behavior change (Phase 5), not a silent one.
3. **Full CRUD + send in scope, across four resources.**
   - `emails`: `list`, `search`, `show`, `download`, `mark`, `move`, `delete`, `send`.
   - `threads`: `show` (print a full conversation), `list`. Conversations are IMAP-native (see
     Object Model); this is the object an FDE uses to trace a vendor exchange end-to-end.
   - `drafts`: `list`, `create`, `edit`, `delete`, `send` (compose lifecycle via the Drafts folder +
     IMAP `APPEND`; `send` hands off to SMTP). One-shot `emails send` stays for fire-and-forget.
   - `folders`: `list`, `create`, `rename`, `delete` (full CRUD — see Decision D1).

   This pulls the **currently-unimplemented SMTP path** (`nodemailer`, already a dep) into a new
   `src/engine/smtp.js`.
4. **A shared `src/resources/` layer is the single source of object-operation truth**, exactly as in
   `fob-stm`. It is the only layer besides the engines (`imap.js`/`smtp.js`) that knows a protocol
   operation. This is the anti-drift mechanism: whatever the CLI does, the library does, by
   construction.
5. **Library = a bound client factory, `fobEmail(account)`** — the Pattern-C analog of `fobStm(creds)`.
   It builds a lazily-connected **session transport (`ctx`)** and hands it to each `buildX(ctx)`
   namespace. Because IMAP is stateful (unlike stateless HTTP), the client also exposes `close()`, and
   the existing one-shot helpers (`listEmails`, `readEmail`) are kept as thin `connect→…→close`
   wrappers (Pattern C: "expose a Session for reuse alongside one-shot helpers").
   ```js
   import { fobEmail } from '@fob/email';
   const mbox = fobEmail(account);            // lazily connects on first call
   try {
     const inbox = await mbox.emails.list({ folder: 'INBOX', unseen: true });
     const msg   = await mbox.emails.get(1423);
     await mbox.emails.move(1423, 'Archive');
   } finally { await mbox.close(); }
   ```
6. **`config` stays a namespace, `accounts` is the domain alias for `profiles`.** Keep the family-wide
   blanket `profiles` object noun with a `config <accounts|profiles>` alias (one yargs line:
   `.command(['accounts', 'profiles'], …)`). We use `accounts` over the standard's suggested
   `mailboxes` because `mailboxes` collides with IMAP folders (our `folders` resource); "my email
   accounts" is the FDE's mental model. Identity caching (`address`) already landed — it conforms.
7. **`@ts-check` + written types**, following `fob-stm`: `src/types/general/` (session `Transport`,
   `Credentials`) and `src/types/domain/` (`Email`, `Attachment`, `Folder`). **`domain/` not `api/`** —
   this is a protocol wrapper over object shapes, not an HTTP-API response wrapper (the mirror of
   `fob-stm`'s "`api/` not `database/`" call).

## Object Model — derived from the spark CLI

The [spark CLI](https://sparkmailapp.com) is a broader product (email + calendar + teams + meetings).
We mine it for the **email-native objects** and deliberately drop its product-integration surface —
`fob-email` is IMAP/SMTP only, for fin-ops automation, not a groupware client.

| Spark command | Object native to IMAP/SMTP? | `fob-email` decision |
|---|---|---|
| `accounts` | Yes — connected accounts | ✅ `config accounts` (credential profiles) |
| `folders` | Yes — folders + message counts | ✅ `folders` resource |
| `emails` | Yes | ✅ `emails` resource |
| `thread` | **Yes** — conversations reconstruct from `References`/`In-Reply-To`; Gmail exposes `X-GM-THRID`; RFC 5256 `THREAD` where supported | ✅ **`threads` resource** (`show`, `list`) |
| `draft` | **Yes** — the Drafts folder + `APPEND` is the compose lifecycle | ✅ **`drafts` resource** (compose → save → send) |
| `search` | Partial — IMAP `SEARCH` covers keyword/header/date; **no semantic** (spark uses embeddings we can't replicate) | ✅ `emails search` (keyword/header/date only — documented deviation) |
| `contacts` / `contact-action` | Weak — IMAP has no contact store (would need CardDAV or header-derivation) | ⏸ **out of scope** — revisit only if we add a directory source |
| `templates` / `template` | Weak — a local-storage convenience, not a protocol object | ⏸ **deferred** — could layer on `drafts` later |
| `events`, `availability`, `meetings`, `meeting`, `team`, `comment`, `skill` | No — calendar / meeting / team **product** features | ❌ excluded (not email) |

**Resulting resource set:** `emails`, `threads`, `folders`, `drafts` (data) + `config accounts` (setup).

## Command Grammar (target surface)

```
fob-email emails list      [--folder INBOX] [--unread] [--from X] [--subject Y] [--since DATE] [--limit N] [--fields ...] [--format table|csv|json] [--json]
fob-email emails search    <query> [--folder INBOX] [--from X] [--since DATE] [--limit N] [--json]   # IMAP SEARCH — keyword/header/date, not semantic
fob-email emails show      <id> [--folder INBOX] [--json]
fob-email emails download  <id> [--attachments] [--output DIR] [--folder INBOX]   # pull invoices/receipts to disk
fob-email emails mark      <id> --read | --unread [--folder INBOX]
fob-email emails move      <id> --to <folder> [--folder INBOX]
fob-email emails delete    <id> [--folder INBOX] [--yes]
fob-email emails send      --to <addr> --subject <s> [--body <t>] [--body-file F] [--attach F ...] [--account NAME]
fob-email emails filter    (pure; filters an envelopes JSON array from stdin — no connection)   # retained power-user pipe

fob-email threads show     <id> [--folder INBOX] [--json]      # full conversation, oldest→newest
fob-email threads list     [--folder INBOX] [--since DATE] [--limit N] [--json]

fob-email drafts list      [--json]
fob-email drafts create    --to <addr> --subject <s> [--body <t>] [--body-file F] [--attach F ...]
fob-email drafts edit      <id> [--to ...] [--subject ...] [--body ...]
fob-email drafts delete    <id> [--yes]
fob-email drafts send      <id>                               # send a saved draft via SMTP

fob-email folders list     [--json]
fob-email folders create   <name>                             # e.g. Invoices/2026
fob-email folders rename   <name> --to <new-name>
fob-email folders delete   <name> [--yes]

fob-email config accounts  <list|add|use|remove|refresh>      # alias: profiles
```

Every read command supports `--json`. `--account NAME` selects a configured profile on any command;
`emails filter` stays connection-free for `list --json | fob-email emails filter …` pipelines.
Actions are always explicit — `fob-email emails` prints its actions and never defaults to `list`;
`fob-email emails 1423` is an error, never an inferred `show`. Every command that targets a message by
`<id>` (a per-folder IMAP UID) takes `--folder` (default `INBOX`) — see Decision D4.

## Proposed Solution — Layering

| Layer | Location | Responsibility |
|---|---|---|
| **Engine (transport)** | `src/engine/imap.js` (`Session`), `src/engine/smtp.js` (new) | Protocol I/O only — connect, fetch, setFlags, move, expunge, append, send, thread. The `ctx` seam. |
| **Resources** | `src/resources/emails.js`, `threads.js`, `drafts.js`, `folders.js` | Object operations defined once. `buildEmails(ctx)` / `buildThreads(ctx)` / … return flat, typed namespaces. The only place besides the engines that composes protocol ops. |
| **Client factory** | `src/index.js` | `fobEmail(account)` → `{ emails, threads, drafts, folders, close() }` + retained one-shot helpers. What workers import; what the CLI calls. |
| **CLI (presentation)** | `src/cli/emails/*`, `threads/*`, `drafts/*`, `folders/*`, `config/*` | Parse argv → clean domain object, call `mbox.<resource>.<action>()`, format via `format.js`. No protocol knowledge. |

**Resource skeleton** (mirrors `fob-stm/src/resources/accounts.js`, adapted for a stateful `ctx`):
```js
// src/resources/emails.js — @ts-check, co-located EmailsApi typedef, @returns-bound
export function buildEmails(ctx) {
  return {
    list:     (opts = {}) => ctx.list(opts),                 // → Envelope[]
    get:      (id, opts = {}) => ctx.fetchFull(id, opts),    // → Email | null
    download: (id, opts = {}) => ctx.fetchAttachments(id, opts),
    mark:     (id, seen, opts = {}) => ctx.setFlag(id, '\\Seen', seen, opts),
    move:     (id, to, opts = {}) => ctx.move(id, to, opts),
    delete:   (id, opts = {}) => ctx.expunge(id, opts),
    send:     (message) => ctx.send(message),                // SMTP path
  };
}
```

**Return shapes** (the protocol analog of `fob-stm`'s category-based model): single-record ops
(`get`, `send`) return the record or `null`; `list` returns a flat `Envelope[]` (IMAP has no
`page_context` — the window is driven by `--limit`/`--since`, and the CLI prints a
`formatPaginationHint`-style "(showing N of M)" from a cheap folder-status count where available).

## Resolved Design Decisions

Each is locked and the resulting work is scheduled in the phase named in **Lands in**.

- **D1 — `folders` gets full CRUD, not just `list`.** An FDE filing receipts wants
  `folders create Invoices/2026`, `folders rename`, `folders delete`. IMAP supports all three
  (`CREATE`/`RENAME`/`DELETE`), the cost is small, and shipping read-only would just defer an obvious
  gap. `delete` carries a `--yes` guard (destructive). **Lands in:** Phase 3 (folders resource).
- **D2 — filtering is `emails filter`.** It operates on the `emails` object stream, so it reads as a
  resource verb and stays discoverable under `emails --help`. It remains **pure/connection-free**
  (`src/domain/filter.js`), so `emails list --json | fob-email emails filter …` needs no second login.
  **Lands in:** Phase 3 (move `src/cli/filter.js` → `src/cli/emails/filter.js`).
- **D3 — compose uses `send`, on both `emails` and `drafts`.** `send` is the domain verb (the grammar
  permits domain verbs; `create` is reserved for `drafts create`, which saves without sending).
  `emails send` is fire-and-forget SMTP; `drafts send <id>` sends a saved draft. **Both share one
  message-builder** (`--to`/`--subject`/`--body`/`--body-file`/repeatable `--attach` → a normalized
  message object) so assembly lives in exactly one place. **Lands in:** Phase 3 (`emails send` +
  builder) and Phase 5 (`drafts send` reuses the builder).
- **D4 — a message `<id>` is a per-folder IMAP UID; write ops require `--folder`.** UIDs are scoped to
  a folder and invalidated on `UIDVALIDITY` change, so a bare id is ambiguous. Every id-targeting
  command takes `--folder` (default `INBOX`); the engine reads and asserts `UIDVALIDITY` on each op and
  throws a clear "message id is stale — re-list the folder" error on mismatch rather than acting on the
  wrong message. `move` names the destination with `--to`. **Lands in:** Phase 1 (engine
  `UIDVALIDITY` assertion in the `ctx` seam) + enforced by every id-targeting handler.

## Open Questions

*(none currently — all design forks resolved above; reopen here if new ones surface during Phase 2's
review gate.)*

## Implementation Phases

### Phase 1: Transport seam + presentation helpers ❌
- [ ] Add `src/engine/smtp.js` — a `nodemailer` transport with the same Pattern-C credential seam
      (validate on connect via `zod`, resolve creds env → config → per-call override).
- [ ] Define the session **`ctx`** — a lazily-connected transport wrapping `Session` (IMAP) + the SMTP
      transport, exposing primitive ops (`list`, `search`, `fetchFull`, `fetchAttachments`, `setFlag`,
      `move`, `expunge`, `append`, `resolveThread`, `createFolder`, `renameFolder`, `deleteFolder`,
      `send`) plus `close()`. This is the `createTransport` analog for a protocol tool.
- [ ] **D4 — `UIDVALIDITY` assertion in the `ctx` seam.** Every id-targeting op opens the named folder,
      compares its `UIDVALIDITY` to the value the id was issued under, and throws a clear "message id is
      stale — re-list the folder" error on mismatch. One guard, inherited by every write handler.
- [ ] Copy the full `src/utils/format.js` set from a sibling wrapper (currently only `formatTable`):
      `formatField`, `formatCsv`, `formatDate`, `formatBytes` (attachment sizes), `formatHeader`,
      `formatSection`, `formatPaginationHint`. Add `src/cli/utils/list.js` column selector
      (`buildColumnSelector`) for `--fields`/`--format`.
- [ ] `jsconfig.json` (gradual `checkJs`), `typecheck` npm script, `typescript` + `@types/node` devDeps.

### Phase 2: `emails` vertical slice — REVIEW GATE ❌
The reviewable prototype (one resource, end to end) before fanning out — the `fob-stm` accounts model.
- [ ] `src/types/general/` (`Transport`/session, `Credentials`) + `src/types/domain/Email.types.js`,
      `Attachment.types.js`.
- [ ] `src/resources/emails.js` — `buildEmails(ctx)`, `@ts-check`, co-located `EmailsApi` typedef,
      `@returns`-bound so `tsc` verifies the impl. Start with `list` + `get`.
- [ ] `fobEmail(account)` factory in `src/index.js` exposing `emails` + `close()`; `clientFor(argv)` in
      `src/cli/_helpers.js` (resolve profile → `fobEmail(account)`). Keep one-shot helpers as wrappers.
- [ ] Refactor `src/cli/list.js` → `src/cli/emails/list.js` and `src/cli/read.js` →
      `src/cli/emails/show.js` (rename `read`→`show`), reduced to presentation: argv→domain, call
      `mbox.emails.*`, **human table by default** + `--json` branch. Wire `emails <action>` into the
      root command tree; `.demandCommand(1)` so `emails` lists its actions.
- [ ] Tests (`tests/` — keep `node --test` or move to Jest ESM per `testing.md`): mock the `ctx`/client,
      assert stdout/stderr/exit via a `captureOutput()` helper. Cover the correct engine call, the
      table output, the `--json` branch, and the error/exit path.
- [ ] **REVIEW GATE:** confirm the stateful-`ctx` + `close()` shape, the `list` return contract, and
      the human-output format read well before fanning out.

### Phase 3: Fan out the rest of `emails` + `folders` (full CRUD) ❌
Each verb follows the Phase-2 recipe (resource method + `@ts-check` handler + human/`--json` output).
- [ ] `emails search` (IMAP `SEARCH`; keyword/header/date — document the no-semantic deviation),
      `emails download` (attachments → disk; "Wrote <path>" to **stderr**), `emails mark`,
      `emails move` (`--to <folder>`), `emails delete` (`--yes` guard). All id-targeting handlers pass
      `--folder` through the D4 guard.
- [ ] **D3 — shared message-builder.** `src/cli/emails/_message.js` maps
      `--to`/`--subject`/`--body`/`--body-file`/repeatable `--attach` → a normalized message object;
      `emails send` (SMTP, fire-and-forget) consumes it. Phase 5's `drafts` reuse the same builder.
- [ ] **D1 — `folders` full CRUD.** `src/resources/folders.js` (`buildFolders(ctx)`:
      `list`/`create`/`rename`/`delete`) + `src/cli/folders/*` (`list`, `create`, `rename`,
      `delete` with `--yes`).
- [ ] **D2 —** move `src/cli/filter.js` → `src/cli/emails/filter.js` (keep `src/domain/filter.js` pure).
- [ ] `npm run typecheck` → 0 errors; all handlers `@ts-check`'d; help tree walks; no-creds → clean exit 1.

### Phase 4: `threads` resource ❌
Conversations are the object an FDE uses to trace a vendor exchange; strategy is server-dependent.
- [ ] Engine: add a thread-resolution op to `Session` — prefer Gmail `X-GM-THRID`, fall back to RFC
      5256 `THREAD`, else client-side reconstruction via `Message-Id`/`References`/`In-Reply-To`.
- [ ] `src/types/domain/Thread.types.js` + `src/resources/threads.js` (`buildThreads(ctx)`:
      `show`, `list`) wired into `fobEmail`.
- [ ] `src/cli/threads/show.js` (full conversation, oldest→newest, human-formatted with
      `formatSection` per message) + `src/cli/threads/list.js`.

### Phase 5: `drafts` resource (compose lifecycle) ❌
- [ ] Engine: `APPEND` to the Drafts folder + draft update/delete on `Session`; `send` bridges to
      `src/engine/smtp.js`.
- [ ] `src/types/domain/Draft.types.js` + `src/resources/drafts.js` (`buildDrafts(ctx)`:
      `list`, `create`, `edit`, `delete`, `send`) wired into `fobEmail`.
- [ ] `src/cli/drafts/*` handlers. **D3 —** `create`/`edit`/`send` reuse the Phase-3 shared builder
      (`src/cli/emails/_message.js`), so one-shot send and draft-send share body/attachment assembly.

### Phase 6: Config conformance ❌
- [ ] Reshape `src/cli/config/` to the blanket `profiles` object noun with `['accounts','profiles']`
      alias; `accounts list` prints a table with the current-`*` marker and a `config: <path>` footer;
      add `--json`. Confirm identity (`address`) caching + `refresh` conform.

### Phase 7: Retire the old shape + publish the breaking change ❌
- [ ] Remove the top-level `list`/`read`/`filter` commands (now under `emails`); update
      `src/cli/index.js` usage/header (drop "JSON on stdout" framing).
- [ ] Rewrite `src/index.js` library surface: `fobEmail` + retained one-shots; document the namespace API.
- [ ] Audit + migrate any worker/pipeline consuming the old flat commands or JSON-by-default output.
- [ ] Update `README`/docs; bump `package.json` version (breaking: command surface + output default).

## Related Files

**Being created:**
- `src/resources/emails.js`, `threads.js`, `drafts.js`, `folders.js` — the shared object-operation layer
- `src/engine/smtp.js` — SMTP transport (`nodemailer`)
- `src/types/general/*`, `src/types/domain/*` (`Email`, `Attachment`, `Thread`, `Draft`, `Folder`) — `@ts-check` typedefs
- `src/cli/emails/*` (`list`, `search`, `show`, `download`, `mark`, `move`, `delete`, `send`, `filter`,
  `_message.js` shared builder), `src/cli/threads/*` (`show`, `list`),
  `src/cli/drafts/*` (`list`, `create`, `edit`, `delete`, `send`),
  `src/cli/folders/*` (`list`, `create`, `rename`, `delete`), `src/cli/utils/list.js`, `jsconfig.json`

**Being refactored:**
- `src/index.js` — `fobEmail(account)` factory (replaces bare one-shot exports as the primary API)
- `src/engine/imap.js` — `Session` becomes the IMAP half of the `ctx` seam; add
  `search`/`setFlag`/`move`/`expunge`/`append`/`resolveThread`/`create|rename|deleteFolder` ops + the
  D4 `UIDVALIDITY` assertion
- `src/cli/index.js` — resource/action command tree; drop flat commands + JSON-default framing
- `src/cli/_helpers.js` — add `clientFor(argv)`
- `src/utils/format.js` — expand to the full shared helper set
- `src/cli/config/*` — `profiles` blanket + `accounts` alias, `--json`, footer

**Being retired / moved:**
- `src/cli/list.js` → `src/cli/emails/list.js`; `src/cli/read.js` → `src/cli/emails/show.js`;
  `src/cli/filter.js` → `src/cli/emails/filter.js`

## Related Notes

- [Reference WIP: Unify the fob-stm CLI and Library on One Shared Resource Layer](../../../fob-stm/docs/wip/cli-lib-unification.md)
- [CLI Command Grammar](/Users/alex/ec2code/alex/engineering-standards/cli/command-grammar.md)
- [CLI Project Structure](/Users/alex/ec2code/alex/engineering-standards/cli/project-structure.md)
- [CLI Output Formatting](/Users/alex/ec2code/alex/engineering-standards/cli/output-formatting.md)
- [CLI Auth Patterns (Pattern C — protocol credentials)](/Users/alex/ec2code/alex/engineering-standards/cli/auth-patterns.md)
- [Config & Secrets](/Users/alex/ec2code/alex/engineering-standards/cli/config-and-secrets.md)
- [WIP Files Pattern](/Users/alex/ec2code/alex/engineering-standards/git-workflow/wip-files.md)
</content>
</invoke>
