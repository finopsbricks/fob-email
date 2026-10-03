# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2026-10-03

### Fixed
- `fob-email --version` printed the host project's version (or `unknown`) when fob-email was installed as a dependency. It now reads its own `package.json`.
- The drafts commands always used a folder named `Drafts`, so they failed or used the wrong folder on providers such as Gmail (`[Gmail]/Drafts`). They now use the provider's special-use Drafts folder, saved on `config accounts add`/`refresh`, or looked up once per session for accounts saved earlier and for `FOB_EMAIL_ACCOUNTS`.
- Sending from an account without an SMTP host tried the IMAP host and failed with a confusing connection error. It now fails straight away and says to add `--smtp-host`.
- `engines` now requires Node.js 22.13, the first release where `node:sqlite` (used by local sync) works without a flag. The SQLite error message names the real requirement.

### Changed
- Sign-in failures print the server's reason and suggest an app password, instead of `Command failed`. Sign-in and network errors link the matching troubleshooting section on finopsbricks.com.
- `getting-started` no longer lists Outlook / Microsoft 365, which need OAuth and can't connect. It adds iCloud, and links the online guides instead of a repository path. The no-account error points to `getting-started`.
- `--help` ends with links to the docs and the landing page.
- README rewritten for first-time users, with a provider table and Beta limits. `package.json` has `homepage`, `repository` and `bugs`.
- Test suite migrated from Node's built-in runner to Jest. Dev tooling only.

## [0.1.1] - 2026-08-31

### Added
- `fob-email getting-started`: setup steps when no account exists, or a note that setup is done. (Shipped in the 0.1.1 tarball; committed to git for 0.2.0.)


### Changed
- Help output: each command's own options now render under `Options:` above a dedicated `Global Options:` group (`--help`, `--version`), instead of being interleaved. Help text only — no behavior change.
