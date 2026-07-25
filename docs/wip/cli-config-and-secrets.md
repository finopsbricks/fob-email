# fob-email — Align to the CLI Config & Secrets Standard

## Status: NOT STARTED

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
- [ ] **Domain alias:** `accounts` (matches current vocabulary) vs a neutral `profiles`-only surface?
      Leaning `accounts` alias.
- [ ] **Config schema key:** store under `accounts:` + `current` (domain-faithful, like fob-stm's
      `orgs:`), or `profiles:` + `current`? Leaning `accounts:` to match the alias.

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

### Phase 2: yargs CLI retrofit ❌ (parent tracker Phase 6 — prerequisite for Phase 3)
- [ ] Replace `bin/cli.js` `parse()`/switch with the yargs skeleton + grammar; keep client exports.

### Phase 3: `config profiles`/`accounts` command surface ❌ (after Phase 2)
- [ ] `fob-email config profiles <list|add|use|remove>` (+ `accounts` alias, `rm` alias).
- [ ] `profiles list` table + current marker + `config: <path>` footer.

### Phase 4: Identity caching (G) ❌
- [ ] Resolve the authenticated mailbox address on `profiles add` + `profiles refresh <name>`/`--all`
      from the IMAP session; cache as non-secret metadata; never block add on failure.

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
