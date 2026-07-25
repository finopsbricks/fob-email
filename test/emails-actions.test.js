import { test } from 'node:test';
import assert from 'node:assert/strict';

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
  assert.deepEqual(seen.setFlag, { id: 5, flag: '\\Seen', on: true, folder: 'INBOX' });
  assert.deepEqual(seen.move, { id: 5, to: 'Archive', folder: 'INBOX' });
  assert.deepEqual(seen.expunge, { id: 5, folder: 'INBOX' });
  assert.deepEqual(seen.fetchAttachments, { id: 5, folder: 'INBOX' });
  assert.deepEqual(seen.send, { to: ['a@b.com'] });
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
  assert.equal(opts.criteria.text, 'invoice');
  assert.equal(opts.criteria.from, 'aws');
  assert.ok(opts.criteria.since instanceof Date);
});

test('searchEmailsHandler rejects a bad --since', async () => {
  const out = captureOutput();
  const client = fakeClient();
  try {
    await assert.rejects(
      () => searchEmailsHandler({ since: '07/01/2026' }, client),
      /--since must be in YYYY-MM-DD/,
    );
  } finally {
    out.restore();
  }
});

// -- mark / move / delete guards ----------------------------------------------

test('markEmailHandler requires exactly one of --read/--unread', async () => {
  const out = captureOutput();
  const client = fakeClient();
  try {
    await assert.rejects(() => markEmailHandler({ id: 1, read: true, unread: true }, client), /exactly one/);
    await assert.rejects(() => markEmailHandler({ id: 1 }, client), /exactly one/);
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
  assert.deepEqual(client.calls.mark[0], { id: 1423, seen: true, opts: { folder: 'INBOX' } });
  assert.match(out.stdout, /Marked #1423 as read/);
  assert.equal(client.calls.closed, 1);
});

test('moveEmailHandler passes destination', async () => {
  const out = captureOutput();
  const client = fakeClient();
  try {
    await moveEmailHandler({ id: 1423, to: 'Archive', folder: 'INBOX' }, client);
  } finally {
    out.restore();
  }
  assert.deepEqual(client.calls.move[0], { id: 1423, to: 'Archive', opts: { folder: 'INBOX' } });
  assert.match(out.stdout, /Moved #1423 from INBOX to Archive/);
});

test('deleteEmailHandler refuses without --yes', async () => {
  const out = captureOutput();
  const client = fakeClient();
  try {
    await assert.rejects(() => deleteEmailHandler({ id: 1423 }, client), /Refusing to delete/);
  } finally {
    out.restore();
  }
  assert.equal(client.calls.delete.length, 0);
});

test('deleteEmailHandler deletes with --yes', async () => {
  const out = captureOutput();
  const client = fakeClient();
  try {
    await deleteEmailHandler({ id: 1423, yes: true, folder: 'INBOX' }, client);
  } finally {
    out.restore();
  }
  assert.deepEqual(client.calls.delete[0], { id: 1423, opts: { folder: 'INBOX' } });
  assert.match(out.stdout, /Deleted #1423/);
});

// -- message builder + send ----------------------------------------------------

test('buildMessage normalizes flags (repeatable to/attach)', () => {
  const msg = buildMessage({ to: ['a@b.com', 'c@d.com'], subject: 'Hi', body: 'yo', attach: ['/tmp/x.pdf'] });
  assert.deepEqual(msg.to, ['a@b.com', 'c@d.com']);
  assert.equal(msg.subject, 'Hi');
  assert.equal(msg.text, 'yo');
  assert.deepEqual(msg.attachments, [{ path: '/tmp/x.pdf', filename: 'x.pdf' }]);
});

test('buildMessage rejects --body + --body-file together', () => {
  assert.throws(() => buildMessage({ to: ['a@b.com'], body: 'x', bodyFile: '/f' }), /only one of --body/);
});

test('buildMessage requires --to', () => {
  assert.throws(() => buildMessage({ subject: 'x' }), /--to <address> is required/);
});

test('sendEmailHandler sends the built message and reports', async () => {
  const out = captureOutput();
  const client = fakeClient({ send: { messageId: '<id@x>', accepted: ['a@b.com'], rejected: [] } });
  try {
    await sendEmailHandler({ to: ['a@b.com'], subject: 'Hi', body: 'yo' }, client);
  } finally {
    out.restore();
  }
  assert.equal(client.calls.send[0].to[0], 'a@b.com');
  assert.match(out.stdout, /Sent to a@b\.com \(<id@x>\)/);
});
