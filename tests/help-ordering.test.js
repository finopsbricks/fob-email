import { describe, it, expect } from '@jest/globals';
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

describe('help layout', () => {
  it("shows a command's own options above the inherited global ones", () => {
    // emails show <id>: Positionals (id) → Options (account/folder/json) → Global Options (help/version)
    expect(helpHeadings('emails show')).toEqual([
      'Positionals:',
      'Options:',
      'Global Options:',
    ]);
  });

  it('keeps positionals first when options are bundled before the positional', () => {
    // config accounts add <name>: field options register alongside the positional; positional must still lead.
    expect(helpHeadings('config accounts add')).toEqual([
      'Positionals:',
      'Options:',
      'Global Options:',
    ]);
  });

  it('omits an empty Options group for commands with no local options', () => {
    expect(helpHeadings('config accounts use')).toEqual([
      'Positionals:',
      'Global Options:',
    ]);
  });

  it('groups global options under their own heading even without positionals', () => {
    // emails send: compose options only, no positional.
    expect(helpHeadings('emails send')).toEqual(['Options:', 'Global Options:']);
  });
});
