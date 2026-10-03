import { test, expect, jest } from '@jest/globals';

/**
 * The drafts commands must use the provider's real Drafts folder (Gmail:
 * `[Gmail]/Drafts`), not a hard-coded `Drafts`. A cached `folders.drafts` on the
 * account wins; otherwise the session resolves it once from the special-use LIST.
 */

const calls = { list: 0, append: [] };

class FakeImapFlow {
  constructor() {
    this.capabilities = new Map();
  }
  async connect() {}
  async logout() {}
  close() {}
  async list() {
    calls.list += 1;
    return [
      { path: 'INBOX', specialUse: '\\Inbox' },
      { path: '[Gmail]/Drafts', specialUse: '\\Drafts' },
      { path: '[Gmail]/Sent Mail', specialUse: '\\Sent' },
    ];
  }
  async append(folder, raw, flags) {
    calls.append.push({ folder, flags });
    return { uid: 7, uidValidity: 1 };
  }
}

jest.unstable_mockModule('imapflow', () => ({ ImapFlow: FakeImapFlow }));
const { connectSession } = await import('../src/engine/imap.js');

const imap = { host: 'imap.gmail.com', user: 'me@gmail.com', pass: 'app-pw' };

test('without a cached folder, drafts go to the special-use Drafts folder (one LIST per session)', async () => {
  calls.list = 0;
  calls.append = [];
  const s = await connectSession({ imap });
  const first = await s.appendDraft('raw-1');
  const second = await s.appendDraft('raw-2');
  expect(first).toEqual({ id: 7, folder: '[Gmail]/Drafts', uidValidity: 1 });
  expect(second.folder).toBe('[Gmail]/Drafts');
  expect(calls.append.map((a) => a.folder)).toEqual(['[Gmail]/Drafts', '[Gmail]/Drafts']);
  expect(calls.append[0].flags).toEqual(['\\Draft']);
  expect(calls.list).toBe(1);
});

test('a cached folders.drafts is used without a LIST', async () => {
  calls.list = 0;
  calls.append = [];
  const s = await connectSession({ imap, folders: { drafts: 'Brouillons' } });
  await s.appendDraft('raw');
  expect(calls.append[0].folder).toBe('Brouillons');
  expect(calls.list).toBe(0);
});
