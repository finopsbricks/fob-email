# @fob/email

Email over IMAP/SMTP (`imapflow` + `nodemailer`) as **objects you read and modify** — emails,
threads, drafts, folders — not IMAP internals. A 2-in-1 wrapper, usable two ways over the same code:

- **CLI** — `fob-email <resource> <action> [options]`, familiar `gh`/`docker`-style grammar
- **import** — `import { fobEmail } from '@fob/email'`; the CLI and the library call the *same*
  `src/resources/` layer, so they never drift.

```
fob-email emails list --unread --from billing        # invoices waiting in the inbox
fob-email emails download 1423 -o ./invoices/         # pull the attachments
fob-email threads show 1423                            # the whole vendor conversation
fob-email emails move 1423 --to Archive
```

## Install

```
npm install
```

## Config

Resolved **flag > env > config file** (each step explicit; no silent fallback).

**Workers** — set `FOB_EMAIL_ACCOUNTS` in the worker's `.env` to a JSON map `{ name: { imap, smtp } }`
(one contract for one or many accounts):

```
FOB_EMAIL_ACCOUNTS={"gmail":{"imap":{"host":"imap.gmail.com","port":993,"user":"me@gmail.com","pass":"app-pw","tls":true},"smtp":{"host":"smtp.gmail.com","port":465,"user":"me@gmail.com","pass":"app-pw","secure":true}}}
```

**CLI / hands-on** — a YAML file under the shared fob family root, `~/.fob/fob-email/config.yml`
(override with `FOB_EMAIL_CONFIG_DIR`), enforced mode `0600`, managed by `config accounts`:

```yaml
current: gmail
accounts:
  gmail:
    imap: { host: imap.gmail.com, port: 993, user: me@gmail.com, pass: app-pw, tls: true }
    smtp: { host: smtp.gmail.com, port: 465, user: me@gmail.com, pass: app-pw, secure: true }
    # server-probed, non-secret metadata (see "Self-describing profiles"):
    address: me@gmail.com
    provider: gmail
    threadStrategy: thread-id
    folders: { drafts: "[Gmail]/Drafts", sent: "[Gmail]/Sent Mail", trash: "[Gmail]/Trash", all: "[Gmail]/All Mail" }
```

Select an account with `--account <name>` on any command (or `fobEmail('name')`); with no name the
current/first account is used.

## CLI

Grammar is `fob-email <resource> <action> [target] [options]`. Output is **human-readable by
default**; add `--json` to any read command for the raw payload (data on stdout, diagnostics on
stderr — pipes stay clean). Actions are always explicit: `fob-email emails` lists its actions, it
never defaults to one.

```
# emails
fob-email emails list      [--folder INBOX] [--unread] [--limit N] [--fields ...] [--json]
fob-email emails search    <query> [--from X] [--subject Y] [--since YYYY-MM-DD] [--json]
fob-email emails show      <id> [--folder INBOX] [--json]
fob-email emails download  <id> [-o DIR]              # save attachments (invoices/receipts)
fob-email emails mark      <id> --read | --unread
fob-email emails move      <id> --to <folder>
fob-email emails delete    <id> --yes
fob-email emails send      --to <addr> --subject <s> [--body <t> | --body-file F] [--attach F ...]
fob-email emails filter    (stdin JSON → filtered JSON; pure, no connection)

# threads (conversations)
fob-email threads list     [--folder INBOX] [--json]
fob-email threads show     <id> [--json]

# drafts (compose lifecycle)
fob-email drafts list
fob-email drafts create    --to <addr> --subject <s> [--body <t> | --body-file F] [--attach F ...]
fob-email drafts edit      <id> ...                   # replaces wholesale (append-new + delete-old)
fob-email drafts delete    <id> --yes
fob-email drafts send      <id>

# folders
fob-email folders list
fob-email folders create   <name>                     # e.g. Invoices/2026
fob-email folders rename   <name> --to <new>
fob-email folders delete   <name> --yes

# sync (local mirror)
fob-email sync run         [--folder INBOX] [--all-folders] [--all-accounts] [--full] [--limit N]
fob-email sync status      [--folder X] [--all-accounts] [--json]
fob-email sync clear       [--folder X] --yes
```

Scripting stays clean with `--json` + the pure filter:

```
fob-email emails list --json | fob-email emails filter --from tally --has-attachment
```

### Local mirror (`sync`)

`sync` mirrors envelopes into a local SQLite store so reads can be served without a round-trip.
Two properties define it:

- **Manual.** There is no daemon, no IDLE, no background refresh, and no auto-sync-on-read. The
  mirror updates when you run `sync run`, and at no other time.
- **Unidirectional** ([D7](docs/decisions/0001-unidirectional-sync.md)). Data flows server → local
  only. Nothing is ever queued or pushed back, so a sync that is interrupted or fails can leave the
  mirror stale but can never leave the mailbox wrong.

Reads stay **live by default** — the mirror is purely additive and no existing command changes
behavior. Pass `--cached` to read locally instead:

```
fob-email sync run --all-folders
fob-email emails list --cached --folder INBOX
fob-email emails search --cached --from aws --since 2026-01-01
fob-email sync status                    # what is mirrored, and how stale
```

A `--cached` read **never silently falls back to live**: if the folder was never synced it errors
and names the `sync run` that fixes it. Staleness (`(cached — synced 3h ago)`) prints on stderr, so
`--json` stdout stays pipe-clean. The mirror stores envelopes and flags, not bodies — so
`emails show` is always live, and `search --cached` refuses `--query` (full-text needs the server)
rather than quietly narrowing to a subject match.

The store lives beside your config (`~/.fob/fob-email/sync.db`, mode 0600) and is disposable —
`sync clear` drops it and the next `sync run` rebuilds it. Requires Node ≥22.5 for `node:sqlite`;
every live path works without it.

## Library

`fobEmail(account)` binds one account into resource namespaces over a lazily-connected transport.
Connections are lazy; `close()` when done (or use the one-shot helpers).

```js
import { fobEmail } from '@fob/email';

const mbox = fobEmail('gmail');
try {
  const { data } = await mbox.emails.list({ unseenOnly: true, limit: 20 });
  const msg = await mbox.emails.get(data[0].id);
  await mbox.emails.move(data[0].id, 'Archive');
  const thread = await mbox.threads.show(data[0].id);
  await mbox.emails.send({ to: ['ops@acme.com'], subject: 'Hi', text: '...' });
} finally {
  await mbox.close();
}
```

Namespaces: `emails` (list, search, get, download, mark, move, delete, send), `threads` (list, show),
`drafts` (list, create, edit, delete, send), `folders` (list, create, rename, delete), and `sync`
(run, runAll, read, status, clear). Plus one-shot helpers `listEmails` / `readEmail` /
`getIdentity` / `getProfile` and the pure `filterEmails`.

`sync` opens the store lazily, so a client that never syncs never touches SQLite:

```js
const mbox = fobEmail('gmail');
try {
  await mbox.sync.runAll();                              // pull every selectable folder
  const { data, syncedAt } = mbox.sync.read({ folder: 'INBOX', unseen: true });
} finally {
  await mbox.close();
}
```

`sync.read()` is synchronous (SQLite is) and throws if the folder was never synced — it does not
fall back to the network.

## Self-describing profiles

Server behaviour is a **property of the account**, probed once and cached (never re-detected per
call). `config accounts add`/`refresh` connect and record, as non-secret metadata:

- `provider` — `gmail | outlook | fastmail | yahoo | generic` (host + capabilities)
- `threadStrategy` — `thread-id` (Gmail `X-GM-EXT-1` / RFC 8474 `OBJECTID`) or `reconstruct`
  (walk `References`/`In-Reply-To`); `threads` dispatches on this, no runtime cascade
- `folders` — special-use paths (the Drafts folder `drafts` APPEND to, etc.)

```
fob-email config accounts add gmail \
  --imap-host imap.gmail.com --imap-user me@gmail.com --imap-pass <app-pw> \
  --smtp-host smtp.gmail.com                  # smtp user/pass default to the imap ones
fob-email config accounts list                # table: current *, ADDRESS, PROVIDER, secrets never shown
fob-email config accounts use work            # switch the current account
fob-email config accounts refresh --all       # re-probe every profile (fixes drift)
```

`add` probes once to verify creds and cache the profile (`--no-verify` skips the network). `accounts`
is an alias of the family-wide `profiles`. Credentials are written at mode `0600`; secrets are never
logged or shown.

## Development

```
npm test           # node --test
npm run typecheck  # tsc over the @ts-check'd modules (gradual checkJs)
```

Architecture: `src/cli/` (presentation) → `src/resources/` (object ops, defined once) →
`src/engine/` (IMAP/SMTP transport, functional factories) — see
`docs/wip/resource-based-cli-alignment.md` for the design and the engineering-standards CLI docs it
follows.
