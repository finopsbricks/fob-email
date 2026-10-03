import { describe, it, expect } from '@jest/globals';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const bin = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'cli.js');

/** Run the CLI against an empty config dir; returns { status, stdout, stderr }. */
function cli(args) {
  const { NODE_OPTIONS, FOB_EMAIL_ACCOUNTS, ...env } = process.env;
  env.FOB_EMAIL_CONFIG_DIR = mkdtempSync(join(tmpdir(), 'email-onb-'));
  try {
    const stdout = execFileSync('node', [bin, ...args], { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] });
    return { status: 0, stdout, stderr: '' };
  } catch (err) {
    return { status: err.status, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

describe('onboarding copy', () => {
  it('getting-started lists supported providers, not Outlook, and links the docs', () => {
    const { status, stdout } = cli(['getting-started']);
    expect(status).toBe(0);
    expect(stdout).toContain('imap.mail.yahoo.com');
    expect(stdout).toContain('imap.mail.me.com');
    expect(stdout).not.toContain('outlook.office365.com');
    expect(stdout).toMatch(/Microsoft 365 are not supported/);
    expect(stdout).toContain('https://finopsbricks.com/docs/email/connect');
    expect(stdout).not.toContain('docs/gmail-setup.md');
  });

  it('--help ends with getting-started and the docs and landing links', () => {
    const { stdout } = cli(['--help']);
    expect(stdout).toContain('New here? Run `fob-email getting-started`.');
    expect(stdout).toContain('Docs: https://finopsbricks.com/docs/email');
    expect(stdout).toContain('About: https://finopsbricks.com/cli/fob-email');
  });

  it('the no-account error points to getting-started', () => {
    const { status, stdout, stderr } = cli(['emails', 'list']);
    expect(status).toBe(1);
    expect(stdout).toBe('');
    expect(stderr).toMatch(/Run `fob-email getting-started`/);
  });
});
