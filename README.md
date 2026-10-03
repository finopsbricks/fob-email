# fob-email — Email CLI and client library

Read, search, download, file and send email from the terminal, from an AI agent, or from Node
code, over IMAP and SMTP. One package, two ways in:

- **The CLI** (`fob-email`): list and search folders, download attachments, mark, move and
  delete messages, work with threads, drafts and folders, and send mail. `--json` on every
  command for scripts, and agent-friendly.
  → [finopsbricks.com/cli/fob-email](https://finopsbricks.com/cli/fob-email)
- **The library** (`import { fobEmail }`): the same operations as a Node client for scripts
  and workers. The CLI calls the same code, so the two never drift.
  → [Docs](https://finopsbricks.com/docs/email)

Works with Gmail, Google Workspace, Yahoo, iCloud, Fastmail and other IMAP servers that accept
a password. **Outlook.com and Microsoft 365 are not supported**: they require OAuth sign-in.

Beta. Not affiliated with or endorsed by Google, Yahoo, Apple, Fastmail or Microsoft.

## Install

```bash
npm install -g @finopsbricks/fob-email
fob-email getting-started
```

Requires Node.js 22.13 or later. If you use the [`fob` dispatcher](https://www.npmjs.com/package/@finopsbricks/fob-cli),
`fob email …` and `fob-email …` are the same command.

## Connect a mailbox

You need your provider's IMAP server and an **app password**: a separate password you create
in your account's security settings. Most providers reject your normal password over IMAP.

| Provider | IMAP host | SMTP host | App password |
| --- | --- | --- | --- |
| Gmail / Google Workspace | `imap.gmail.com` | `smtp.gmail.com` | [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords) (needs 2-Step Verification) |
| Yahoo | `imap.mail.yahoo.com` | `smtp.mail.yahoo.com` | [Account Security](https://login.yahoo.com/account/security) → Generate app password |
| iCloud | `imap.mail.me.com` | `smtp.mail.me.com` (port 587) | [account.apple.com](https://account.apple.com/) → App-Specific Passwords |
| Fastmail | `imap.fastmail.com` | `smtp.fastmail.com` | Settings → Privacy & Security → Manage app passwords |

```bash
read -rs IMAP_PASS        # paste the app password; keeps it out of your shell history
fob-email config accounts add personal \
  --imap-host imap.gmail.com --imap-user you@gmail.com \
  --imap-pass "$IMAP_PASS" --smtp-host smtp.gmail.com
unset IMAP_PASS

fob-email folders list    # proves sign-in works
```

- `--smtp-host` enables sending. SMTP reuses the IMAP username and password unless you pass
  `--smtp-user` / `--smtp-pass`.
- iCloud: the IMAP username is the part before `@`, and SMTP needs the full address and port
  587: `--imap-user you --smtp-user you@icloud.com --smtp-port 587 --no-smtp-secure`.
- `add` signs in once to check the password (`--no-verify` skips it). Adding an existing name
  replaces it.

Step-by-step guides per provider: [Providers](https://finopsbricks.com/docs/email/providers).
Problems: [Troubleshooting](https://finopsbricks.com/docs/email/troubleshooting).

## Use the CLI

Grammar: `fob-email <resource> <action> [target] [options]`. Run `fob-email <resource> --help`
for its actions, or `fob-email <resource> <action> --help` for flags.

```bash
fob-email emails list --unseen --limit 20
fob-email emails search --from billing@vendor.example --since 2026-09-01
fob-email emails show 1423
fob-email emails download 1423 -o ./invoices
fob-email emails move 1423 --to Invoices/2026
fob-email threads show 1423
fob-email emails send --to finance@example.com --subject "Invoices" --body-file summary.txt --attach invoices/INV-2291.pdf
```

| Resource | Actions |
| --- | --- |
| `emails` | `list`, `search`, `show`, `download`, `mark`, `move`, `delete`, `send`, `filter` |
| `threads` | `list`, `show` |
| `drafts` | `list`, `create`, `edit`, `delete`, `send` |
| `folders` | `list`, `create`, `rename`, `delete` |
| `sync` | `run`, `status`, `clear` |
| `config accounts` | `list`, `add`, `use`, `remove`, `refresh` (alias: `config profiles`) |

- **IDs belong to a folder.** The ID in `emails list` is the message's IMAP UID in that folder:
  pass the same `--folder` (default `INBOX`) when you use it.
- **Reading doesn't mark messages as read.**
- **`--json`** prints JSON on stdout; errors and notes go to stderr. `emails filter` filters a
  JSON list from stdin offline: `fob-email emails list --json | fob-email emails filter --has-attachment`.
- **Deletes need `--yes`.** `emails delete` removes the message permanently.
- **`--account <name>`** picks a mailbox; `config accounts use` sets the default.
- **Local sync** (`sync run`, then `--cached` on `emails list` / `search`) mirrors headers and
  flags into a local SQLite database for fast, offline reads. It never runs on its own.

Full guides: [Reading mail](https://finopsbricks.com/docs/email/cli/reading-mail),
[Sending and changing mail](https://finopsbricks.com/docs/email/cli/changing-mail),
[Output and scripting](https://finopsbricks.com/docs/email/cli/output-and-scripting),
[AI agents](https://finopsbricks.com/docs/email/cli/ai-agents),
[Command reference](https://finopsbricks.com/docs/email/cli/reference/setup).

## Use as a library

```js
import { fobEmail } from '@finopsbricks/fob-email';

const mbox = fobEmail('personal'); // an account name, or { imap: {…}, smtp: {…} }
try {
  const { data } = await mbox.emails.list({ unseenOnly: true, limit: 20 });
  const files = await mbox.emails.download(data[0].id, { folder: 'INBOX' });
  await mbox.emails.move(data[0].id, 'Archive', { folder: 'INBOX' });
} finally {
  await mbox.close();
}
```

Namespaces: `emails`, `threads`, `drafts`, `folders` and `sync`, plus `filterEmails`,
`listEmails`, `readEmail` and `getProfile`. Passing an object skips the environment and config
file entirely. See [Use the library](https://finopsbricks.com/docs/email/integration/library).

## Credentials and configuration

- **CLI:** `~/.fob/fob-email/config.yml`, written with mode 0600. The password is stored in
  plain text, protected by file permissions. Override the folder with `FOB_EMAIL_CONFIG_DIR`.
- **Workers and CI:** `FOB_EMAIL_ACCOUNTS`, a JSON map of `{ name: { imap, smtp } }`. When set,
  it takes precedence over the config file. See `.env.example`.
- **Local mirror:** `sync.db` next to the config file, mode 0600. Safe to delete.

Credentials go only to your mail provider, never to FinOpsBricks.

## Beta limits

- Password and app-password sign-in only: no OAuth, so no Outlook.com, Microsoft 365, or
  Google Workspace domains that block app passwords.
- Search is IMAP search (keywords, sender, subject, date), not semantic.
- No paging: lists return the newest messages up to `--limit` (default 50).
- No reply or forward with threading headers; `drafts edit` replaces the whole draft.
- Local sync is manual, stores headers and flags (not bodies), and hasn't yet been tested at
  scale against every provider. Start a large mailbox with `sync run --limit`.
- Passwords live in a plain YAML file (mode 0600), not your system keychain.

Missing something? [Open an issue](https://github.com/finopsbricks/fob-email/issues).

## Develop

```bash
npm install
npm test           # jest (ESM); needs Node 22.13+
npm run typecheck  # tsc over the @ts-check'd modules
```

Layers: `src/cli/` (commands) → `src/resources/` (each operation, defined once) →
`src/engine/` (IMAP/SMTP transport). See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
