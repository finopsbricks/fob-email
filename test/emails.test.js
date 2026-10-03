import { test, expect } from '@jest/globals';

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
  expect(seen[0]).toEqual({ folder: 'Archive', limit: 10 });
});

test('buildEmails.get maps (id, opts) → ctx.fetchFull({ id, ...opts })', async () => {
  const seen = [];
  const ctx = { fetchFull: async (arg) => { seen.push(arg); return { id: arg.id }; } };
  const emails = buildEmails(ctx);
  await emails.get(1423, { folder: 'INBOX' });
  expect(seen[0]).toEqual({ id: 1423, folder: 'INBOX' });
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
  expect(out.stdout).toMatch(/ID\s+FROM\s+SUBJECT\s+DATE/);
  expect(out.stdout).toMatch(/billing@aws\.com/);
  expect(out.stdout).toMatch(/Invoice INV-0412/);
  expect(client.calls.closed).toBe(1);
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
  expect(parsed.length).toBe(2);
  expect(parsed[0].id).toBe(1423);
});

test('listEmailsHandler prints (no messages) on an empty folder', async () => {
  const out = captureOutput();
  const client = fakeClient({ list: { data: [], uidValidity: 1, folder: 'INBOX' } });
  try {
    await listEmailsHandler({ limit: 50 }, client);
  } finally {
    out.restore();
  }
  expect(out.stdout).toMatch(/\(no messages\)/);
});

// -- show handler --------------------------------------------------------------

const fullEmail = {
  id: 1423,
  messageId: '<abc@aws.com>',
  from: { name: 'AWS', addr: 'billing@aws.com' },
  to: [{ name: null, addr: 'me@example.com' }],
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
  expect(out.stdout).toMatch(/Email #1423/);
  expect(out.stdout).toMatch(/From:\s+AWS <billing@aws\.com>/);
  expect(out.stdout).toMatch(/Your invoice is attached\./);
  expect(out.stdout).toMatch(/invoice\.pdf.*42\.0 KB/);
  expect(client.calls.get[0]).toEqual({ id: 1423, opts: { folder: 'INBOX' } });
  expect(client.calls.closed).toBe(1);
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
  expect(parsed.id).toBe(1423);
  expect(parsed.subject).toBe('Invoice INV-0412');
});
