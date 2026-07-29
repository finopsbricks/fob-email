import { test, expect } from '@jest/globals';

import { parseMessageIds, groupThreads, threadOf } from '../src/domain/threads.js';
import { buildThreads } from '../src/resources/threads.js';
import { listThreadsHandler } from '../src/cli/threads/list.js';
import { showThreadHandler } from '../src/cli/threads/show.js';
import { captureOutput, fakeClient } from './helpers.js';

// -- pure grouping (the reconstruct core) --------------------------------------

test('parseMessageIds extracts <...> tokens', () => {
  expect(parseMessageIds('<a@x> <b@y>')).toEqual(['<a@x>', '<b@y>']);
  expect(parseMessageIds(null)).toEqual([]);
  expect(parseMessageIds('none')).toEqual([]);
});

test('groupThreads links a reply chain and separates unrelated mail', () => {
  const nodes = [
    { id: 1, messageId: '<root@x>', refs: [], date: '2026-07-01T00:00:00Z' },
    { id: 2, messageId: '<reply1@x>', refs: ['<root@x>'], date: '2026-07-02T00:00:00Z' },
    { id: 3, messageId: '<reply2@x>', refs: ['<root@x>', '<reply1@x>'], date: '2026-07-03T00:00:00Z' },
    { id: 9, messageId: '<other@y>', refs: [], date: '2026-07-01T00:00:00Z' },
  ];
  const groups = groupThreads(nodes);
  expect(groups.length).toBe(2);
  const big = groups.find((g) => g.length === 3);
  expect(big.map((n) => n.id)).toEqual([1, 2, 3]); // sorted oldest→newest
});

test('threadOf returns the conversation containing the target, oldest→newest', () => {
  const nodes = [
    { id: 2, messageId: '<reply@x>', refs: ['<root@x>'], date: '2026-07-02T00:00:00Z' },
    { id: 1, messageId: '<root@x>', refs: [], date: '2026-07-01T00:00:00Z' },
  ];
  expect(threadOf(nodes, 2).map((n) => n.id)).toEqual([1, 2]);
  expect(threadOf(nodes, 999)).toEqual([]);
});

// -- resource delegation -------------------------------------------------------

test('buildThreads.show maps (id, opts) → ctx.resolveThread', async () => {
  const seen = [];
  const ctx = { resolveThread: async (a) => (seen.push(a), { id: 't', messages: [] }), listThreads: async () => [] };
  const threads = buildThreads(ctx);
  await threads.show(5, { folder: 'INBOX' });
  expect(seen[0]).toEqual({ id: 5, folder: 'INBOX' });
});

// -- handlers ------------------------------------------------------------------

test('listThreadsHandler renders a summary table', async () => {
  const out = captureOutput();
  const client = fakeClient({
    threadsList: [
      { id: '<root@x>', count: 3, subject: 'Invoice thread', latest: { id: 1423, from: { addr: 'aws@x' }, date: '2026-07-24T00:00:00Z' } },
    ],
  });
  try {
    await listThreadsHandler({ folder: 'INBOX', limit: 50 }, client);
  } finally {
    out.restore();
  }
  expect(out.stdout).toMatch(/LATEST\s+MSGS\s+SUBJECT\s+DATE/);
  expect(out.stdout).toMatch(/Invoice thread/);
  expect(client.calls.closed).toBe(1);
});

test('showThreadHandler prints a conversation table and delegates', async () => {
  const out = captureOutput();
  const client = fakeClient({
    thread: {
      id: '<root@x>',
      messages: [
        { id: 1, from: { addr: 'a@x' }, subject: 'Re: Invoice', date: '2026-07-01T00:00:00Z' },
        { id: 2, from: { addr: 'b@y' }, subject: 'Re: Invoice', date: '2026-07-02T00:00:00Z' },
      ],
    },
  });
  try {
    await showThreadHandler({ id: '1', folder: 'INBOX' }, client);
  } finally {
    out.restore();
  }
  expect(out.stdout).toMatch(/Thread <root@x> \(2 messages\)/);
  expect(out.stdout).toMatch(/a@x/);
  expect(client.calls.threads.show[0]).toEqual({ id: 1, opts: { folder: 'INBOX' } });
});

test('showThreadHandler --json emits the raw thread', async () => {
  const out = captureOutput();
  const client = fakeClient({ thread: { id: 't1', messages: [{ id: 1 }] } });
  try {
    await showThreadHandler({ id: '1', json: true }, client);
  } finally {
    out.restore();
  }
  expect(JSON.parse(out.stdout).id).toBe('t1');
});
