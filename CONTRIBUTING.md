# Contributing to fob-email

Thanks for helping. Bug reports, provider reports and pull requests are all welcome.

## Before you open an issue

- Run with `FOB_DEBUG=1` and include the command and error output.
- **Remove secrets first.** Never paste a password or app password. Replace real email
  addresses and message contents with placeholders.
- Say which provider and IMAP host you use (for example Gmail, `imap.gmail.com`).

## Development

```bash
npm install
npm test          # jest (ESM); the sync tests need Node 22.13 or later
npm run typecheck # tsc against jsconfig (@ts-check)
```

- Source is plain JavaScript with JSDoc types and `// @ts-check`.
- Layers: `src/cli/` (presentation) → `src/resources/` (each operation, defined once and shared
  by the CLI and the library) → `src/engine/` (IMAP/SMTP transport).
- Each CLI command lives in `src/cli/<resource>/<action>.js`. Tests mock the transport; they
  never connect to a real mailbox.
- Test writes (move, delete, send) against a throwaway mailbox, never your real one.

## Pull requests

- One change per pull request, with tests.
- Add a line under `## [Unreleased]` in `CHANGELOG.md`.
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/)
  (`feat:`, `fix:`, `docs:` …).

By contributing, you agree that your contributions are licensed under the Apache-2.0 license.
