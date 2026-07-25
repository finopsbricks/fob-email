# fob-email — Align to the CLI Config & Secrets Standard

## Status: ALL PHASES DONE (2026-07-25)

All five numbered phases are complete. One cross-cutting decision remains open: the **Precedence**
item below (retiring the single-account `IMAP_*`/`SMTP_*` env vars) is a worker-facing contract
change, deliberately not bundled into any phase — see the note in Phase 1.

Bring the email wrapper (`@fob/email`, binary `fob-email`) in line with the CLI **config /
secrets / command-surface** standard decided for `fob-stm` this session. Same decisions, adapted to
email's protocol (IMAP/SMTP, Pattern C) and vocabulary ("account"). The command-surface piece
depends on the separate yargs CLI retrofit (parent tracker Phase 6).

Standard: `engineering-standards/cli/config-and-secrets.md`, `cli/command-grammar.md`,
`cli/auth-patterns.md` (Pattern C). Sibling decision log: `fob-stm/docs/wip/cli-config-and-secrets.md`.

---

## Problem Statement

Current state (audit 2026-07-25):

- **Config dir is off-standard.** Credentials file is `~/.fobs/email.yml` (via `FOBS_CONFIG_DIR` /
  `FOB_EMAIL_CONFIG`) — the retired `~/.fobs` aggregator location, not the `~/.fob/<tool>/` family
  root. `src/config.js` documents "mode 600" but does **not enforce** it on write.
- **No profile-management command.** `bin/cli.js` is a hand-rolled `parse()` switch with `list` /
  `read` / `filter` only. Accounts are managed by hand-editing YAML or setting env — there is no
  `config`/`accounts` add/list/use/remove.
- **No self-describing identity.** A profile stores host/port/user/pass; nothing records *which
  mailbox address* it authenticates as, so `list`-style output can't show the real identity.
- **Mixed env conventions.** Single-account `IMAP_*` / `SMTP_*` plus multi-account
  `FOB_EMAIL_ACCOUNTS` (JSON). Precedence isn't the standard flag > env > config.

Reference files: `src/config.js` (`resolveAccount`), `bin/cli.js`, `src/index.js`
(`connect`/`listEmails`/`readEmail`, `Session`), `src/engine/imap.js`, `package.json`
(`@fob/email`, bin `fob-email`).

## Proposed Solution — apply the session's decisions to email

Pre-customer, so **hard refactor, no migration** (same call as fob-stm). Map each decision:

- **B — config dir.** Move to `~/.fob/fob-email/config.yml`, mode `0600` **enforced on write**,
  resolved via `os.homedir()` (multi-OS), override `FOB_EMAIL_CONFIG_DIR`. Drop `~/.fobs` /
  `FOBS_CONFIG_DIR` / `FOB_EMAIL_CONFIG`.
- **F — one file.** Keep a single `config.yml`; separate the **secret** (IMAP/SMTP password) from
  **metadata** (host, port, user, tls, address) in the data model — the seam a future keychain uses.
- **A — secret storage.** Plaintext `0600` baseline behind the `config.js` seam (`resolveAccount` is
  already that seam). Email secret = the connection password (Pattern C). Keychain later, opt-in.
- **E — command surface.** Add `fob-email config profiles <list|add|use|remove>` with the domain
  alias **`accounts`** (email's term; avoid `mailboxes` — collides with IMAP folders). **Depends on
  the yargs retrofit** (Phase 6): the hand-rolled `parse()` can't cleanly host a nested config tree.
  `profiles list` shows a table + current-`*` marker + `config: <path>` footer.
- **G — identity caching.** Cache the authenticated **mailbox address** (+ display name) as
  non-secret metadata — email's analog of org_id/org_slug. No new server endpoint needed: a
  successful `connect()` already knows the logged-in identity, so resolve on `profiles add` and
  `profiles refresh`, and never block add on it.
- **Precedence.** Standardize to flag > `FOB_EMAIL_ACCOUNTS` env > config current profile; retire the
  single-account `IMAP_*` / `SMTP_*` convenience vars.

## Open Questions

- [x] **Package rename?** `@fob/lib-email` → `@fob/email` — **done** (2026-07-25). Aligned scope with
      `@fob/stm`; binary stays `fob-email`. No worker imports the package yet, so nothing to migrate.
      Repo also moved `lib/lib-email/` → `cli/fob-email/` alongside the other `cli/*` wrappers.
- [x] **Domain alias:** resolved — `profiles` is the primary surface (mirrors fob-stm), `accounts` is
      the domain alias. Both `fob-email config profiles …` and `… config accounts …` work.
- [x] **Config schema key:** resolved — stored under `accounts:` + `current` (domain-faithful). The CLI
      surface says `profiles` (standard term); the stored data says `accounts` (email's term).

## Implementation Phases

### Phase 1: Config storage on-standard ✅ (2026-07-25)
- [x] Moved config to `~/.fob/fob-email/config.yml`; resolved via `os.homedir()`; `FOB_EMAIL_CONFIG_DIR`
      override; dropped `~/.fobs`/`FOBS_CONFIG_DIR`/`FOB_EMAIL_CONFIG`.
- [x] Enforce mode `0600` on every write — `saveConfig` chmods after write, so it holds on rewrite too
      (not just create, which is all `writeFileSync({mode})` guarantees).
- [x] Secret/metadata seam realized the fob-stm way (decision A): `config.js` is the sole reader/writer
      of the password; `listAccounts()` returns metadata only (omits `pass`). Kept `resolveAccount` as
      the seam — it still reconstitutes the full `{imap, smtp}` object the client needs, unchanged.
- [x] Added storage mutators `addAccount`/`removeAccount`/`useAccount`/`listAccounts` + pointer renamed
      `default:` → `current:`. These are the primitives Phase 3's CLI verbs will call. Tests in
      `test/config.test.js` (0600 enforcement, secret omission, current-pointer reassignment).

> **Not done here (deliberately):** retiring the single-account `IMAP_*`/`SMTP_*` env vars (the
> "Precedence" decision) is a worker-facing contract change, not a Phase 1 storage bullet — deferred to
> the precedence/command-surface work. `IMAP_*` + `FOB_EMAIL_ACCOUNTS` still resolve as before.

### Phase 2: yargs CLI retrofit ✅ (2026-07-25, parent tracker Phase 6)
- [x] Replaced `bin/cli.js` hand-rolled `parse()`/switch with the fob-stm yargs skeleton:
      `bin/cli.js` → `src/cli/index.js` `run()`, per-command modules `src/cli/{list,read,filter}.js`,
      shared `src/cli/_helpers.js` (`safe`, `emitJson`, `readStdin`). Added `yargs` dep.
- [x] Behavior preserved: same `list`/`read <id>`/`filter` surface + flags, JSON on stdout. Now with
      `--help`/`--version`, `.strict()` unknown-arg rejection, and `FOB_DEBUG=1` stack traces.
- [x] Client exports (`src/index.js`) untouched — the retrofit is CLI-only. `config accounts` tree
      slots into `src/cli/index.js` next (Phase 3).

### Phase 3: `config profiles`/`accounts` command surface ✅ (2026-07-25)
- [x] `fob-email config profiles <list|add|use|remove>` with `accounts` domain alias and `rm` alias.
      Tree: `src/cli/config/{index,list,add,use,remove}.js` calling the Phase 1 storage mutators.
- [x] `list` renders a table (current marked `*`) + `(* = current)  config: <path>` footer; `--json`
      for raw output. Secrets never printed (table or json) — verified in `test/cli-config.test.js`.
- [x] `add <name>` takes `--imap-*` (required host/user/pass) + optional `--smtp-*` block (enabled by
      `--smtp-host`; smtp user/pass default to the imap ones). Does **not** touch the network — identity
      caching stays in Phase 4 (decision G: adding creds must not require a round-trip).

### Phase 4: Identity caching (G) ✅ (2026-07-25)
- [x] `getIdentity(account)` on the client (`src/index.js`) → `{ address }`, resolved from the IMAP
      `Session` (`imap.js` `identity()`). IMAP has no whoami: the address is the login user, and a
      successful connect is the validation. Exposed on the client so workers can self-identify too.
- [x] `config accounts refresh [name] --all` re-resolves and caches the address; `add` verifies on
      save (best-effort). Both go through `refreshIdentity()` which never throws — `--no-verify` skips
      the network on `add`. Cached `address` is non-secret metadata via `setAccountIdentity`; surfaces
      as the `ADDRESS` column in `list` (shown once any account has resolved one).
- [x] Never blocks add on failure — verified manually (ECONNREFUSED → warn on stderr, `(unresolved)`
      on stdout, exit 0) and in `test/cli-config.test.js` (cached-identity rendering).

> Honest limitation: IMAP can't return a mailbox address independent of the login username, so
> `address` == the authenticated `imap.user`. The value is *validation* (creds actually work) + a
> self-describing config, not a second independent identifier like fob-stm's org_id/slug.

### Phase 5: Naming alignment ✅ (2026-07-25)
- [x] Renamed `@fob/lib-email` → `@fob/email` (`package.json`, `package-lock.json`, `README.md`); kept
      bin `fob-email`. No worker imports to update.
- [x] Moved repo `lib/lib-email/` → `cli/fob-email/` to sit with the `cli/*` wrapper family.

## Related Files

- `src/config.js` — `resolveAccount`; the storage seam to repoint at `~/.fob/fob-email/`
- `bin/cli.js` — hand-rolled parser to replace with yargs (Phase 2)
- `src/index.js` / `src/engine/imap.js` — client core + IMAP session (source of the cached address)
- `package.json` — `@fob/email` (renamed from `@fob/lib-email`, Phase 5 ✅)

## Related Notes

- `engineering-standards/cli/config-and-secrets.md` — the standard this WIP implements
- `engineering-standards/cli/command-grammar.md` — the `config profiles <verb>` surface
- `engineering-standards/cli/auth-patterns.md` — Pattern C (protocol/connection credentials)
- `finopsbricks/cli/fob-stm/docs/wip/cli-config-and-secrets.md` — the reference decision log
- `engineering-standards/docs/wip/cli-standards-and-wrappers.md` — parent effort (Phase 6 = retrofit lib-email)
