import { test, expect } from '@jest/globals';

import { buildEmails } from '../src/resources/emails.js';
import { searchEmailsHandler } from '../src/cli/emails/search.js';
import { markEmailHandler } from '../src/cli/emails/mark.js';
import { moveEmailHandler } from '../src/cli/emails/move.js';
import { deleteEmailHandler } from '../src/cli/emails/delete.js';
import { sendEmailHandler } from '../src/cli/emails/send.js';
import { buildMessage } from '../src/cli/emails/_message.js';
import { captureOutput, fakeClient, ExitError } from './helpers.js';

// -- resource delegation -------------------------------------------------------

test('buildEmails mutations map to the right ctx ops', async () => {
  const seen = {};
  const ctx = {
    setFlag: async (a) => (seen.setFlag = a),
    move: async (a) => (seen.move = a),
    expunge: async (a) => (seen.expunge = a),
    fetchAttachments: async (a) => (seen.fetchAttachments = a),
    send: async (m) => (seen.send = m),
  };
  const emails = buildEmails(ctx);
  await emails.mark(5, true, { folder: 'INBOX' });
  await emails.move(5, 'Archive', { folder: 'INBOX' });
  await emails.delete(5, { folder: 'INBOX' });
  await emails.download(5, { folder: 'INBOX' });
  await emails.send({ to: ['a@b.com'] });
  expect(seen.setFlag).toEqual({ id: 5, flag: '\\Seen', on: true, folder: 'INBOX' });
  expect(seen.move).toEqual({ id: 5, to: 'Archive', folder: 'INBOX' });
  expect(seen.expunge).toEqual({ id: 5, folder: 'INBOX' });
  expect(seen.fetchAttachments).toEqual({ id: 5, folder: 'INBOX' });
  expect(seen.send).toEqual({ to: ['a@b.com'] });
});

// -- search --------------------------------------------------------------------

test('searchEmailsHandler builds criteria from flags', async () => {
  const out = captureOutput();
  const client = fakeClient({ search: { data: [], uidValidity: 1, folder: 'INBOX' } });
  try {
    await searchEmailsHandler({ query: 'invoice', from: 'aws', since: '2026-07-01', limit: 50 }, client);
  } finally {
    out.restore();
  }
  const opts = client.calls.search[0];
  expect(opts.criteria.text).toBe('invoice');
  expect(opts.criteria.from).toBe('aws');
  expect(opts.criteria.since instanceof Date).toBeTruthy();
});

test('searchEmailsHandler rejects a bad --since', async () => {
  const out = captureOutput();
  const client = fakeClient();
  try {
    await expect(
      () => searchEmailsHandler({ since: '07/01/2026' }, client),
    ).rejects.toThrow(/--since must be in YYYY-MM-DD/);
  } finally {
    out.restore();
  }
});

// -- mark / move / delete guards ----------------------------------------------

test('markEmailHandler requires exactly one of --read/--unread', async () => {
  const out = captureOutput();
  const client = fakeClient();
  try {
    await expect(() => markEmailHandler({ id: 1, read: true, unread: true }, client)).rejects.toThrow(/exactly one/);
    await expect(() => markEmailHandler({ id: 1 }, client)).rejects.toThrow(/exactly one/);
  } finally {
    out.restore();
  }
});

test('markEmailHandler --read marks seen and closes', async () => {
  const out = captureOutput();
  const client = fakeClient();
  try {
    await markEmailHandler({ id: 1423, read: true, folder: 'INBOX' }, client);
  } finally {
    out.restore();
  }
  expect(client.calls.mark[0]).toEqual({ id: 1423, seen: true, opts: { folder: 'INBOX' } });
  expect(out.stdout).toMatch(/Marked #1423 as read/);
  expect(client.calls.closed).toBe(1);
});

test('moveEmailHandler passes destination', async () => {
  const out = captureOutput();
  const client = fakeClient();
  try {
    await moveEmailHandler({ id: 1423, to: 'Archive', folder: 'INBOX' }, client);
  } finally {
    out.restore();
  }
  expect(client.calls.move[0]).toEqual({ id: 1423, to: 'Archive', opts: { folder: 'INBOX' } });
  expect(out.stdout).toMatch(/Moved #1423 from INBOX to Archive/);
});

test('deleteEmailHandler refuses without --yes', async () => {
  const out = captureOutput();
  const client = fakeClient();
  try {
    await expect(() => deleteEmailHandler({ id: 1423 }, client)).rejects.toThrow(/Refusing to delete/);
  } finally {
    out.restore();
  }
  expect(client.calls.delete.length).toBe(0);
});

test('deleteEmailHandler deletes with --yes', async () => {
  const out = captureOutput();
  const client = fakeClient();
  try {
    await deleteEmailHandler({ id: 1423, yes: true, folder: 'INBOX' }, client);
  } finally {
    out.restore();
  }
  expect(client.calls.delete[0]).toEqual({ id: 1423, opts: { folder: 'INBOX' } });
  expect(out.stdout).toMatch(/Deleted #1423/);
});

// -- message builder + send ----------------------------------------------------

test('buildMessage normalizes flags (repeatable to/attach)', () => {
  const msg = buildMessage({ to: ['a@b.com', 'c@d.com'], subject: 'Hi', body: 'yo', attach: ['/tmp/x.pdf'] });
  expect(msg.to).toEqual(['a@b.com', 'c@d.com']);
  expect(msg.subject).toBe('Hi');
  expect(msg.text).toBe('yo');
  expect(msg.attachments).toEqual([{ path: '/tmp/x.pdf', filename: 'x.pdf' }]);
});

test('buildMessage rejects --body + --body-file together', () => {
  expect(() => buildMessage({ to: ['a@b.com'], body: 'x', bodyFile: '/f' })).toThrow(/only one of --body/);
});

test('buildMessage requires --to', () => {
  expect(() => buildMessage({ subject: 'x' })).toThrow(/--to <address> is required/);
});

test('sendEmailHandler sends the built message and reports', async () => {
  const out = captureOutput();
  const client = fakeClient({ send: { messageId: '<id@x>', accepted: ['a@b.com'], rejected: [] } });
  try {
    await sendEmailHandler({ to: ['a@b.com'], subject: 'Hi', body: 'yo' }, client);
  } finally {
    out.restore();
  }
  expect(client.calls.send[0].to[0]).toBe('a@b.com');
  expect(out.stdout).toMatch(/Sent to a@b\.com \(<id@x>\)/);
});
