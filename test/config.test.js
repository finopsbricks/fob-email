import { test, expect } from '@jest/globals';
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
  expect(cfg.CONFIG_PATH).toBe(join(dir, 'config.yml'));
});

test('addAccount writes config.yml at mode 0600 and sets first account current', () => {
  cfg.addAccount('gmail', gmail);
  expect(existsSync(cfg.CONFIG_PATH)).toBe(true);
  expect(statSync(cfg.CONFIG_PATH).mode & 0o777).toBe(0o600);
  expect(cfg.loadConfig().current).toBe('gmail');
});

test('resolveAccount returns imap/smtp with pass for the current account', () => {
  const a = cfg.resolveAccount();
  expect(a.imap.host).toBe('imap.gmail.com');
  expect(a.imap.pass).toBe('app-pw');
  expect(a.smtp.host).toBe('smtp.gmail.com');
});

test('listAccounts returns metadata only — never the password', () => {
  const { current, accounts } = cfg.listAccounts();
  expect(current).toBe('gmail');
  expect(accounts.length).toBe(1);
  expect(accounts[0].imap.host).toBe('imap.gmail.com');
  expect('pass' in accounts[0].imap).toBe(false);
  expect(JSON.stringify(accounts).includes('app-pw')).toBe(false);
});

test('useAccount switches current; unknown name throws', () => {
  cfg.addAccount('work', { imap: { host: 'mail.work.com', port: 993, user: 'a@work.com', pass: 'pw', tls: true } });
  cfg.useAccount('work');
  expect(cfg.loadConfig().current).toBe('work');
  expect(() => cfg.useAccount('nope')).toThrow(/No account named 'nope'/);
});

test('removeAccount reassigns current when removing the active account', () => {
  cfg.removeAccount('work');
  expect(cfg.loadConfig().current).toBe('gmail');
  // secret is not lingering in some stale copy — file still parses and stays 0600
  expect(statSync(cfg.CONFIG_PATH).mode & 0o777).toBe(0o600);
  expect(readFileSync(cfg.CONFIG_PATH, 'utf8').includes('current: gmail')).toBe(true);
});

test('precedence: FOB_EMAIL_ACCOUNTS env selects by name and beats config for the default', () => {
  // config currently has only `gmail` (current).
  process.env.FOB_EMAIL_ACCOUNTS = JSON.stringify({
    envbox: { imap: { host: 'imap.env.com', port: 993, user: 'e@env.com', pass: 'envpw', tls: true } },
  });
  try {
    expect(cfg.resolveAccount('envbox').imap.host).toBe('imap.env.com'); // named from env
    expect(cfg.resolveAccount().imap.host).toBe('imap.env.com'); // no name → env beats config current
  } finally {
    delete process.env.FOB_EMAIL_ACCOUNTS;
  }
  expect(cfg.resolveAccount().imap.host).toBe('imap.gmail.com'); // env gone → config current
});
