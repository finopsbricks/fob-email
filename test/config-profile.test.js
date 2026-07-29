import { test, expect } from '@jest/globals';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Own throwaway config dir before importing config.js (CONFIG_DIR resolves once).
process.env.FOB_EMAIL_CONFIG_DIR = mkdtempSync(join(tmpdir(), 'fob-email-prof-'));
delete process.env.FOB_EMAIL_ACCOUNTS;

const cfg = await import('../src/config.js');

const gmail = {
  imap: { host: 'imap.gmail.com', port: 993, user: 'me@gmail.com', pass: 'app-pw', tls: true },
};

test('setAccountProfile caches probe metadata; resolveAccount preserves it', () => {
  cfg.addAccount('gmail', gmail);
  cfg.setAccountProfile('gmail', {
    address: 'me@gmail.com',
    provider: 'gmail',
    threadStrategy: 'gmail-thrid',
  });

  const a = cfg.resolveAccount('gmail');
  expect(a.provider).toBe('gmail'); // survives zod .parse (declared, not stripped)
  expect(a.threadStrategy).toBe('gmail-thrid');
  expect(a.imap.pass).toBe('app-pw'); // creds intact
});

test('setAccountProfile merges — partial updates leave other fields', () => {
  cfg.setAccountProfile('gmail', { threadStrategy: 'reconstruct' });
  const a = cfg.resolveAccount('gmail');
  expect(a.address).toBe('me@gmail.com'); // untouched
  expect(a.threadStrategy).toBe('reconstruct'); // updated
});

test('listAccounts surfaces provider/threadStrategy, never the password', () => {
  const { accounts } = cfg.listAccounts();
  const g = accounts.find((x) => x.name === 'gmail');
  expect(g.provider).toBe('gmail');
  expect(g.threadStrategy).toBe('reconstruct');
  expect(JSON.stringify(accounts).includes('app-pw')).toBeFalsy();
});

test('setAccountIdentity still works (delegates to setAccountProfile)', () => {
  cfg.setAccountIdentity('gmail', { address: 'other@gmail.com' });
  expect(cfg.resolveAccount('gmail').address).toBe('other@gmail.com');
});
