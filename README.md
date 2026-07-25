# @fob/email

Generic email primitives over IMAP/SMTP (`imapflow` + `nodemailer`), usable two ways:

- **import** in a worker — `import { connect, listEmails, filterEmails } from '@fob/email'`
- **CLI** for hands-on use / skills — `fob-email list --unseen`

The library is **generic** (list / filter / read / send / reply / move / flag). Domain
workflows (e.g. invoice intake) are **compositions** of these primitives, built in the
caller — not in this lib. Design rationale: company-ops `email/lib-email-design.md`.

## Install

```
npm install
```

## Config

Resolved **env-first**, with a YAML file fallback for CLI use.

**Workers** — supply secrets via the worker's `.env` (loaded with `dotenv`), the fob convention:

```
IMAP_HOST=  IMAP_PORT=993  IMAP_USER=  IMAP_PASSWORD=  IMAP_TLS=true
SMTP_HOST=  SMTP_PORT=465  SMTP_USER=  SMTP_PASS=  SMTP_SECURE=true
```

For multiple accounts, set `FOB_EMAIL_ACCOUNTS` to a JSON map `{ name: { imap, smtp } }`.

**CLI / hands-on** — a YAML file under the shared fob family root, `~/.fob/fob-email/config.yml`
(override the dir with `FOB_EMAIL_CONFIG_DIR`); enforced mode `0600`:

```yaml
current: gmail
accounts:
  gmail:
    imap: { host: imap.gmail.com, port: 993, user: me@gmail.com, pass: app-pw, tls: true }
    smtp: { host: smtp.gmail.com, port: 465, user: me@gmail.com, pass: app-pw, secure: true }
```

Precedence — named account: `FOB_EMAIL_ACCOUNTS` env → file. Default (no name): `IMAP_*` env
→ file `current` → first file account → first env account. So a worker's `.env` always wins;
the file is the fallback.

## Library

```js
import { connect, listEmails, filterEmails } from '@fob/email';

// batched: one login, many ops
const mb = await connect('gmail');
const envs = await mb.list({ unseenOnly: true, limit: 20 });
const msg = await mb.read({ id: envs[0].id });
await mb.close();

// one-shots
const all = await listEmails({ account: 'gmail', limit: 10 });
const withPdf = filterEmails(all, { hasAttachment: true }); // pure, no connection
```

## CLI

```
fob-email list --account gmail --unseen --limit 20
fob-email read 380611 --account gmail
fob-email list --account gmail | fob-email filter --from tally --has-attachment
```

JSON on stdout, logs on stderr, meaningful exit codes — so a worker and a shell pipeline
consume it the same way. `fob-email --help` lists everything.

### Managing accounts

The config file above can also be managed from the CLI (`accounts` is an alias of `profiles`):

```
fob-email config accounts add gmail \
  --imap-host imap.gmail.com --imap-user me@gmail.com --imap-pass <app-pw> \
  --smtp-host smtp.gmail.com                 # smtp user/pass default to the imap ones
fob-email config accounts list               # table, current marked with *, secrets never shown
fob-email config accounts use work           # switch the current account
fob-email config accounts remove gmail       # (alias: rm)
```

Credentials are written to `~/.fob/fob-email/config.yml` at mode `0600`.

## Status

First slice: `list`, `filter`, `read` (+ `Session` object, `connect`).
Next: `send`, `reply` (threaded), `move`, `flag`, `downloadAttachments`, `fetchThread`.
