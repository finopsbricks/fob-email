import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const bin = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'cli.js');

/** Run `<command> --help` and return the heading lines in the order shown. */
function helpHeadings(args) {
  const out = execFileSync('node', [bin, ...args.split(' '), '--help'], {
    encoding: 'utf8',
  });
  return out
    .split('\n')
    .filter((l) => /^(Positionals:|Options:|Global Options:)$/.test(l));
}

test("shows a command's own options above the inherited global ones", () => {
  // emails show <id>: Positionals (id) → Options (account/folder/json) → Global Options (help/version)
  assert.deepEqual(helpHeadings('emails show'), [
    'Positionals:',
    'Options:',
    'Global Options:',
  ]);
});

test('keeps positionals first when options are bundled before the positional', () => {
  // config accounts add <name>: field options register alongside the positional; positional must still lead.
  assert.deepEqual(helpHeadings('config accounts add'), [
    'Positionals:',
    'Options:',
    'Global Options:',
  ]);
});

test('omits an empty Options group for commands with no local options', () => {
  assert.deepEqual(helpHeadings('config accounts use'), [
    'Positionals:',
    'Global Options:',
  ]);
});

test('groups global options under their own heading even without positionals', () => {
  // emails send: compose options only, no positional.
  assert.deepEqual(helpHeadings('emails send'), ['Options:', 'Global Options:']);
});
