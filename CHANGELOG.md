# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- Test suite migrated from Node's built-in runner (`node --test`) to Jest (native ESM), matching the CLI testing standard and the other `fob-*` wrappers. Adds `jest`/`jest-junit` dev dependencies and `jest.config.cjs`; `test/helpers.js` (`captureOutput()`/`fakeClient`) and all assertions preserved. Dev-tooling only — no runtime or published-behavior change, so no version bump.

## [0.1.1] - 2026-07-29

### Changed
- Help output: each command's own options now render under `Options:` above a dedicated `Global Options:` group (`--help`, `--version`), instead of being interleaved. Help text only — no behavior change.
