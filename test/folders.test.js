import { test, expect } from '@jest/globals';

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
  expect(seen.create).toBe('Invoices/2026');
  expect(seen.rename).toEqual({ n: 'Invoices', t: 'Bills' });
  expect(seen.delete).toBe('Junk');
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
  expect(out.stdout).toMatch(/PATH\s+SPECIAL\s+SUBSCRIBED/);
  expect(out.stdout).toMatch(/\[Gmail\]\/Sent/);
  expect(client.calls.closed).toBe(1);
});

test('createFolderHandler creates and reports', async () => {
  const out = captureOutput();
  const client = fakeClient();
  try {
    await createFolderHandler({ name: 'Invoices/2026' }, client);
  } finally {
    out.restore();
  }
  expect(client.calls.folders.create[0]).toBe('Invoices/2026');
  expect(out.stdout).toMatch(/Created folder Invoices\/2026/);
});

test('renameFolderHandler requires --to', async () => {
  const out = captureOutput();
  const client = fakeClient();
  try {
    await expect(() => renameFolderHandler({ name: 'A' }, client)).rejects.toThrow(/--to <new-name> is required/);
  } finally {
    out.restore();
  }
});

test('deleteFolderHandler refuses without --yes', async () => {
  const out = captureOutput();
  const client = fakeClient();
  try {
    await expect(() => deleteFolderHandler({ name: 'Junk' }, client)).rejects.toThrow(/Refusing to delete folder/);
  } finally {
    out.restore();
  }
  expect(client.calls.folders.delete.length).toBe(0);
});
