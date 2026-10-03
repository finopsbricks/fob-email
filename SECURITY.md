# Security policy

Please report vulnerabilities privately through GitHub's
[private vulnerability reporting](https://github.com/finopsbricks/fob-email/security/advisories/new),
not in a public issue.

fob-email runs on your machine and talks directly to your mail server over IMAP and SMTP.
Credentials are stored in `~/.fob/fob-email/config.yml` (file mode 0600) or read from the
`FOB_EMAIL_ACCOUNTS` environment variable. They are never sent to FinOpsBricks. The optional
local mirror (`sync.db`, mode 0600) sits next to the config file.

If you think a password was exposed, revoke the app password at your provider (or change the
account password), create a new one, and re-add the account with `fob-email config accounts add`.
