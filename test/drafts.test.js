import { test } from 'node:test';
import assert from 'node:assert/strict';

import { mapSpecialFolders } from '../src/engine/capabilities.js';
import { buildDrafts } from '../src/resources/drafts.js';
import { createDraftHandler } from '../src/cli/drafts/create.js';
import { editDraftHandler } from '../src/cli/drafts/edit.js';
import { deleteDraftHandler } from '../src/cli/drafts/delete.js';
import { sendDraftHandler } from '../src/cli/drafts/send.js';
import { captureOutput, fakeClient } from './helpers.js';

// -- pure special-folder mapping (probe extension) -----------------------------

test('mapSpecialFolders maps SPECIAL-USE flags to paths (Gmail-style)', () => {
  const folders = mapSpecialFolders([
    { path: 'INBOX', specialUse: null },
    { path: '[Gmail]/Drafts', specialUse: '\\Drafts' },
    { path: '[Gmail]/Sent Mail', specialUse: '\\Sent' },
    { path: '[Gmail]/Trash', specialUse: '\\Trash' },
    { path: '[Gmail]/All Mail', specialUse: '\\All' },
  ]);
  assert.equal(folders.drafts, '[Gmail]/Drafts');
  assert.equal(folders.sent, '[Gmail]/Sent Mail');
  assert.equal(folders.trash, '[Gmail]/Trash');
  assert.equal(folders.all, '[Gmail]/All Mail');
  assert.equal(folders.junk, null);
});

// -- resource delegation -------------------------------------------------------

test('buildDrafts delegates to the ctx draft ops', async () => {
  const seen = {};
  const ctx = {
    listDrafts: async () => (seen.list = true) && { data: [], folder: 'Drafts' },
    createDraft: async (m) => (seen.create = m),
    editDraft: async (id, m) => (seen.edit = { id, m }),
    deleteDraft: async (id) => (seen.delete = id),
    sendDraft: async (id) => (seen.send = id),
  };
  const drafts = buildDrafts(ctx);
  await drafts.create({ to: ['a@b.com'] });
  await drafts.edit(5, { to: ['c@d.com'] });
  await drafts.delete(5);
  await drafts.send(6);
  assert.deepEqual(seen.create, { to: ['a@b.com'] });
  assert.deepEqual(seen.edit, { id: 5, m: { to: ['c@d.com'] } });
  assert.equal(seen.delete, 5);
  assert.equal(seen.send, 6);
});

// -- handlers ------------------------------------------------------------------

test('createDraftHandler builds a message, saves, reports the id', async () => {
  const out = captureOutput();
  const client = fakeClient({ draftRef: { id: 10, folder: '[Gmail]/Drafts' } });
  try {
    await createDraftHandler({ to: ['a@b.com'], subject: 'Hi', body: 'yo' }, client);
  } finally {
    out.restore();
  }
  assert.deepEqual(client.calls.drafts.create[0].to, ['a@b.com']);
  assert.match(out.stdout, /Saved draft #10 to \[Gmail\]\/Drafts/);
});

test('editDraftHandler replaces and reports the new id', async () => {
  const out = captureOutput();
  const client = fakeClient({ draftRef: { id: 11, folder: 'Drafts' } });
  try {
    await editDraftHandler({ id: '10', to: ['a@b.com'], subject: 'v2' }, client);
  } finally {
    out.restore();
  }
  assert.equal(client.calls.drafts.edit[0].id, 10);
  assert.match(out.stdout, /Replaced draft #10 → #11/);
});

test('deleteDraftHandler refuses without --yes', async () => {
  const out = captureOutput();
  const client = fakeClient();
  try {
    await assert.rejects(() => deleteDraftHandler({ id: '10' }, client), /Refusing to delete draft/);
  } finally {
    out.restore();
  }
  assert.equal(client.calls.drafts.delete.length, 0);
});

test('sendDraftHandler sends and reports recipients', async () => {
  const out = captureOutput();
  const client = fakeClient({ sendResult: { messageId: '<d@x>', accepted: ['a@b.com'], rejected: [] } });
  try {
    await sendDraftHandler({ id: '10' }, client);
  } finally {
    out.restore();
  }
  assert.equal(client.calls.drafts.send[0], 10);
  assert.match(out.stdout, /Sent draft #10 to a@b\.com \(<d@x>\)/);
});
