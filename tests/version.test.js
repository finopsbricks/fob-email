import { describe, it, expect } from '@jest/globals';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const bin = join(root, 'bin', 'cli.js');
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

function run(cmd, cwd) {
  const { NODE_OPTIONS, ...env } = process.env;
  return execFileSync('node', [cmd, '--version'], { encoding: 'utf8', cwd, env }).trim();
}

// Guards the explicit version read in src/cli/index.js. The original bug (yargs
// reporting the host project's version, or "unknown") only reproduced when
// fob-email was installed as a dependency with yargs hoisted, so it can't be
// reproduced in-repo; it was verified by installing a packed tarball.
describe('--version', () => {
  it("prints the package's version from any working directory", () => {
    expect(run(bin, mkdtempSync(join(tmpdir(), 'email-ver-')))).toBe(version);
  });

  it('prints it when run through a symlink, as npm installs the bin', () => {
    const dir = mkdtempSync(join(tmpdir(), 'email-ver-'));
    const link = join(dir, 'fob-email');
    symlinkSync(bin, link);
    expect(run(link, dir)).toBe(version);
  });
});
