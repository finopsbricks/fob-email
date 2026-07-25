import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildFolders } from '../src/resources/folders.js';
import { listFoldersHandler } from '../src/cli/folders/list.js';
import { createFolderHandler } from '../src/cli/folders/create.js';
import { renameFolderHandler } from '../src/cli/folders/rename.js';
import { deleteFolderHandler } from '../src/cli/folders/delete.js';
import { captureOutput, fakeClient } from './helpers.js';

test('buildFolders delegates to the transport folder ops', async () => {
  const seen = {};
  const ctx = {
    listFolders: async () => (seen.list = true) && [],
    createFolder: async (n) => (seen.create = n),
    renameFolder: async (n, t) => (seen.rename = { n, t }),
    deleteFolder: async (n) => (seen.delete = n),
  };
  const folders = buildFolders(ctx);
  await folders.list();
  await folders.create('Invoices/2026');
  await folders.rename('Invoices', 'Bills');
  await folders.delete('Junk');
  assert.equal(seen.create, 'Invoices/2026');
  assert.deepEqual(seen.rename, { n: 'Invoices', t: 'Bills' });
  assert.equal(seen.delete, 'Junk');
});

test('listFoldersHandler renders a table', async () => {
  const out = captureOutput();
  const client = fakeClient({
    foldersList: [
      { path: 'INBOX', name: 'INBOX', specialUse: null, subscribed: true },
      { path: '[Gmail]/Sent', name: 'Sent', specialUse: '\\Sent', subscribed: true },
    ],
  });
  try {
    await listFoldersHandler({}, client);
  } finally {
    out.restore();
  }
  assert.match(out.stdout, /PATH\s+SPECIAL\s+SUBSCRIBED/);
  assert.match(out.stdout, /\[Gmail\]\/Sent/);
  assert.equal(client.calls.closed, 1);
});

test('createFolderHandler creates and reports', async () => {
  const out = captureOutput();
  const client = fakeClient();
  try {
    await createFolderHandler({ name: 'Invoices/2026' }, client);
  } finally {
    out.restore();
  }
  assert.equal(client.calls.folders.create[0], 'Invoices/2026');
  assert.match(out.stdout, /Created folder Invoices\/2026/);
});

test('renameFolderHandler requires --to', async () => {
  const out = captureOutput();
  const client = fakeClient();
  try {
    await assert.rejects(() => renameFolderHandler({ name: 'A' }, client), /--to <new-name> is required/);
  } finally {
    out.restore();
  }
});

test('deleteFolderHandler refuses without --yes', async () => {
  const out = captureOutput();
  const client = fakeClient();
  try {
    await assert.rejects(() => deleteFolderHandler({ name: 'Junk' }, client), /Refusing to delete folder/);
  } finally {
    out.restore();
  }
  assert.equal(client.calls.folders.delete.length, 0);
});
