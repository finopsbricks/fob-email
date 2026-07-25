import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildEmails } from '../src/resources/emails.js';
import { listEmailsHandler } from '../src/cli/emails/list.js';
import { showEmailHandler } from '../src/cli/emails/show.js';
import { captureOutput, fakeClient } from './helpers.js';

// -- resource layer: delegates to the transport, adds no paths of its own ------

test('buildEmails.list forwards opts to ctx.list', async () => {
  const seen = [];
  const ctx = { list: async (opts) => { seen.push(opts); return { data: [], uidValidity: 1, folder: 'INBOX' }; } };
  const emails = buildEmails(ctx);
  await emails.list({ folder: 'Archive', limit: 10 });
  assert.deepEqual(seen[0], { folder: 'Archive', limit: 10 });
});

test('buildEmails.get maps (id, opts) → ctx.fetchFull({ id, ...opts })', async () => {
  const seen = [];
  const ctx = { fetchFull: async (arg) => { seen.push(arg); return { id: arg.id }; } };
  const emails = buildEmails(ctx);
  await emails.get(1423, { folder: 'INBOX' });
  assert.deepEqual(seen[0], { id: 1423, folder: 'INBOX' });
});

// -- list handler --------------------------------------------------------------

const envelopes = {
  data: [
    { id: 1423, from: { name: 'AWS', addr: 'billing@aws.com' }, to: null, subject: 'Invoice INV-0412', date: '2026-07-24T10:23:01Z', flags: [], hasAttachment: true },
    { id: 1422, from: { name: null, addr: 'noreply@stripe.com' }, to: null, subject: 'Receipt #9981', date: '2026-07-23T08:00:00Z', flags: ['\\Seen'], hasAttachment: false },
  ],
  uidValidity: 42,
  folder: 'INBOX',
};

test('listEmailsHandler renders a human table and closes the client', async () => {
  const out = captureOutput();
  const client = fakeClient({ list: envelopes });
  try {
    await listEmailsHandler({ folder: 'INBOX', limit: 50 }, client);
  } finally {
    out.restore();
  }
  assert.match(out.stdout, /ID\s+FROM\s+SUBJECT\s+DATE/);
  assert.match(out.stdout, /billing@aws\.com/);
  assert.match(out.stdout, /Invoice INV-0412/);
  assert.equal(client.calls.closed, 1);
});

test('listEmailsHandler --json emits the raw envelope array', async () => {
  const out = captureOutput();
  const client = fakeClient({ list: envelopes });
  try {
    await listEmailsHandler({ json: true, limit: 50 }, client);
  } finally {
    out.restore();
  }
  const parsed = JSON.parse(out.stdout);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].id, 1423);
});

test('listEmailsHandler prints (no messages) on an empty folder', async () => {
  const out = captureOutput();
  const client = fakeClient({ list: { data: [], uidValidity: 1, folder: 'INBOX' } });
  try {
    await listEmailsHandler({ limit: 50 }, client);
  } finally {
    out.restore();
  }
  assert.match(out.stdout, /\(no messages\)/);
});

// -- show handler --------------------------------------------------------------

const fullEmail = {
  id: 1423,
  messageId: '<abc@aws.com>',
  from: { name: 'AWS', addr: 'billing@aws.com' },
  to: [{ name: null, addr: 'alex@cashflowy.io' }],
  subject: 'Invoice INV-0412',
  date: '2026-07-24T10:23:01Z',
  text: 'Your invoice is attached.',
  html: null,
  attachments: [{ filename: 'invoice.pdf', contentType: 'application/pdf', size: 43000 }],
};

test('showEmailHandler renders headers, body and attachments', async () => {
  const out = captureOutput();
  const client = fakeClient({ get: fullEmail });
  try {
    await showEmailHandler({ id: '1423', folder: 'INBOX' }, client);
  } finally {
    out.restore();
  }
  assert.match(out.stdout, /Email #1423/);
  assert.match(out.stdout, /From:\s+AWS <billing@aws\.com>/);
  assert.match(out.stdout, /Your invoice is attached\./);
  assert.match(out.stdout, /invoice\.pdf.*42\.0 KB/);
  assert.deepEqual(client.calls.get[0], { id: 1423, opts: { folder: 'INBOX' } });
  assert.equal(client.calls.closed, 1);
});

test('showEmailHandler --json emits the raw message', async () => {
  const out = captureOutput();
  const client = fakeClient({ get: fullEmail });
  try {
    await showEmailHandler({ id: '1423', json: true }, client);
  } finally {
    out.restore();
  }
  const parsed = JSON.parse(out.stdout);
  assert.equal(parsed.id, 1423);
  assert.equal(parsed.subject, 'Invoice INV-0412');
});
