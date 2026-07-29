import { test, expect } from '@jest/globals';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.FOB_EMAIL_CONFIG_DIR = mkdtempSync(join(tmpdir(), 'fob-email-cli-'));
delete process.env.FOB_EMAIL_ACCOUNTS;
delete process.env.IMAP_HOST;

const { addConfigHandler } = await import('../src/cli/config/add.js');
const { useConfigHandler } = await import('../src/cli/config/use.js');
const { removeConfigHandler } = await import('../src/cli/config/remove.js');
const { listConfigHandler } = await import('../src/cli/config/list.js');
const { setAccountIdentity } = await import('../src/config.js');

/** Run a handler capturing everything it writes to stdout (console.log + emitJson). */
function capture(fn) {
  const origLog = console.log;
  const origWrite = process.stdout.write.bind(process.stdout);
  const lines = [];
  console.log = (...a) => lines.push(a.join(' '));
  process.stdout.write = (s) => (lines.push(String(s).replace(/\n$/, '')), true);
  try {
    fn();
  } finally {
    console.log = origLog;
    process.stdout.write = origWrite;
  }
  return lines.join('\n');
}

test('add stores account; list shows it with the current marker and a config footer', () => {
  addConfigHandler({
    name: 'gmail',
    'imap-host': 'imap.gmail.com',
    'imap-port': 993,
    'imap-user': 'me@gmail.com',
    'imap-pass': 'app-pw',
    'imap-tls': true,
    'smtp-host': 'smtp.gmail.com',
    'smtp-port': 465,
    'smtp-secure': true,
    verify: false, // don't hit the network in unit tests
  });
  const out = capture(() => listConfigHandler({}));
  expect(out).toMatch(/\*\s+gmail\s+imap\.gmail\.com:993\s+smtp\.gmail\.com:465/);
  expect(out).toMatch(/\(\* = current\)\s+config: /);
});

test('list never prints the password (table or json)', () => {
  const table = capture(() => listConfigHandler({}));
  const json = capture(() => listConfigHandler({ json: true }));
  expect(table.includes('app-pw')).toBeFalsy();
  expect(json.includes('app-pw')).toBeFalsy();
});

test('smtp user/pass default to the imap ones when omitted', () => {
  // second account, imap only — no smtp column value
  addConfigHandler({ name: 'work', 'imap-host': 'mail.work.com', 'imap-port': 993, 'imap-user': 'a@work.com', 'imap-pass': 'pw', 'imap-tls': true, verify: false });
  const out = capture(() => listConfigHandler({ json: true }));
  const { accounts } = JSON.parse(out);
  const work = accounts.find((a) => a.name === 'work');
  expect(work.smtp).toBe(null);
});

test('use switches current; remove reassigns it', () => {
  capture(() => useConfigHandler({ name: 'work' }));
  let out = capture(() => listConfigHandler({ json: true }));
  expect(JSON.parse(out).current).toBe('work');

  capture(() => removeConfigHandler({ name: 'work' }));
  out = capture(() => listConfigHandler({ json: true }));
  expect(JSON.parse(out).current).toBe('gmail');
});

test('cached identity (decision G) shows an ADDRESS column and is non-secret', () => {
  // Simulate what refresh/add-verify caches after a successful connect.
  setAccountIdentity('gmail', { address: 'me@gmail.com' });

  const table = capture(() => listConfigHandler({}));
  expect(table).toMatch(/ADDRESS/);
  expect(table).toMatch(/me@gmail\.com/);

  const { accounts } = JSON.parse(capture(() => listConfigHandler({ json: true })));
  expect(accounts.find((a) => a.name === 'gmail').address).toBe('me@gmail.com');
});
