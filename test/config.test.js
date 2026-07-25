import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, statSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Point the store at a throwaway dir and clear interfering env BEFORE importing
// config.js — CONFIG_DIR is resolved once at module load.
const dir = mkdtempSync(join(tmpdir(), 'fob-email-cfg-'));
process.env.FOB_EMAIL_CONFIG_DIR = dir;
delete process.env.FOB_EMAIL_ACCOUNTS;
delete process.env.IMAP_HOST;

const cfg = await import('../src/config.js');

const gmail = {
  imap: { host: 'imap.gmail.com', port: 993, user: 'me@gmail.com', pass: 'app-pw', tls: true },
  smtp: { host: 'smtp.gmail.com', port: 465, user: 'me@gmail.com', pass: 'app-pw', secure: true },
};

test('CONFIG_PATH resolves under FOB_EMAIL_CONFIG_DIR', () => {
  assert.equal(cfg.CONFIG_PATH, join(dir, 'config.yml'));
});

test('addAccount writes config.yml at mode 0600 and sets first account current', () => {
  cfg.addAccount('gmail', gmail);
  assert.ok(existsSync(cfg.CONFIG_PATH));
  assert.equal(statSync(cfg.CONFIG_PATH).mode & 0o777, 0o600);
  assert.equal(cfg.loadConfig().current, 'gmail');
});

test('resolveAccount returns imap/smtp with pass for the current account', () => {
  const a = cfg.resolveAccount();
  assert.equal(a.imap.host, 'imap.gmail.com');
  assert.equal(a.imap.pass, 'app-pw');
  assert.equal(a.smtp.host, 'smtp.gmail.com');
});

test('listAccounts returns metadata only — never the password', () => {
  const { current, accounts } = cfg.listAccounts();
  assert.equal(current, 'gmail');
  assert.equal(accounts.length, 1);
  assert.equal(accounts[0].imap.host, 'imap.gmail.com');
  assert.ok(!('pass' in accounts[0].imap));
  assert.ok(!JSON.stringify(accounts).includes('app-pw'));
});

test('useAccount switches current; unknown name throws', () => {
  cfg.addAccount('work', { imap: { host: 'mail.work.com', port: 993, user: 'a@work.com', pass: 'pw', tls: true } });
  cfg.useAccount('work');
  assert.equal(cfg.loadConfig().current, 'work');
  assert.throws(() => cfg.useAccount('nope'), /No account named 'nope'/);
});

test('removeAccount reassigns current when removing the active account', () => {
  cfg.removeAccount('work');
  assert.equal(cfg.loadConfig().current, 'gmail');
  // secret is not lingering in some stale copy — file still parses and stays 0600
  assert.equal(statSync(cfg.CONFIG_PATH).mode & 0o777, 0o600);
  assert.ok(readFileSync(cfg.CONFIG_PATH, 'utf8').includes('current: gmail'));
});
