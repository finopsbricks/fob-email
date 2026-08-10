import { test, expect } from '@jest/globals';

import { fetchByUids, fetchEnvelopes } from '../src/engine/imap.js';

/**
 * Phase 0 — the envelope fetch is batched: one ranged FETCH for the whole
 * window, not one `fetchOne` per message. These tests assert the property that
 * matters (round-trip count) plus the two things batching puts at risk:
 * ordering (the server streams in its own order) and messages that vanish
 * between the SEARCH and the FETCH.
 */

/**
 * A fake imapflow client. `fetch()` is an async generator like the real one and
 * yields in `serverOrder` (default: ascending uid) regardless of the requested
 * order — the behaviour that makes re-projection necessary.
 */
function fakeImap({ uids = [], messages = {}, serverOrder = null } = {}) {
  const calls = { search: [], fetch: [], fetchOne: [] };
  return {
    calls,
    search: async (query) => (calls.search.push(query), uids),
    fetchOne: async (uid) => (calls.fetchOne.push(uid), messages[uid] ?? null),
    async *fetch(range, query, options) {
      calls.fetch.push({ range: [...range], query, options });
      const order = serverOrder ?? [...range].map(Number).sort((a, b) => a - b);
      for (const uid of order) {
        const msg = messages[uid];
        if (msg) yield msg;
      }
    },
  };
}

/** Minimal imapflow-shaped message. */
const msg = (uid, subject, date) => ({
  uid,
  envelope: { subject, date: new Date(date), messageId: `<${uid}@x>`, from: [{ name: 'A', address: 'a@b.com' }] },
  flags: new Set(),
  bodyStructure: null,
});

// -- fetchByUids ---------------------------------------------------------------

test('fetchByUids issues exactly one FETCH for the whole set', async () => {
  const c = fakeImap({ messages: { 1: msg(1, 'one', '2026-01-01'), 2: msg(2, 'two', '2026-01-02') } });
  await fetchByUids(c, [1, 2], { uid: true, envelope: true });
  expect(c.calls.fetch).toHaveLength(1);
  expect(c.calls.fetch[0].range).toEqual([1, 2]);
  expect(c.calls.fetchOne).toHaveLength(0);
});

test('fetchByUids returns messages in the requested order, not arrival order', async () => {
  // Asked newest-first (3,2,1); the server streams ascending (1,2,3).
  const messages = { 1: msg(1, 'one', '2026-01-01'), 2: msg(2, 'two', '2026-01-02'), 3: msg(3, 'three', '2026-01-03') };
  const c = fakeImap({ messages, serverOrder: [1, 2, 3] });
  const out = await fetchByUids(c, [3, 2, 1], { uid: true, envelope: true });
  expect(out.map((m) => m.uid)).toEqual([3, 2, 1]);
});

test('fetchByUids drops uids the server did not return (expunged mid-flight)', async () => {
  // uid 2 vanished between the SEARCH and the FETCH — no gap, no undefined.
  const c = fakeImap({ messages: { 1: msg(1, 'one', '2026-01-01'), 3: msg(3, 'three', '2026-01-03') } });
  const out = await fetchByUids(c, [3, 2, 1], { uid: true, envelope: true });
  expect(out.map((m) => m.uid)).toEqual([3, 1]);
});

test('fetchByUids short-circuits on an empty set without issuing a FETCH', async () => {
  const c = fakeImap();
  const out = await fetchByUids(c, [], { uid: true, envelope: true });
  expect(out).toEqual([]);
  expect(c.calls.fetch).toHaveLength(0);
});

// -- fetchEnvelopes ------------------------------------------------------------

test('fetchEnvelopes does one SEARCH + one FETCH and returns newest first', async () => {
  const messages = {
    1: msg(1, 'oldest', '2026-01-01'),
    2: msg(2, 'middle', '2026-01-02'),
    3: msg(3, 'newest', '2026-01-03'),
  };
  const c = fakeImap({ uids: [1, 2, 3], messages });
  const out = await fetchEnvelopes(c, { all: true }, 50);

  expect(c.calls.search).toHaveLength(1);
  expect(c.calls.fetch).toHaveLength(1);
  expect(c.calls.fetchOne).toHaveLength(0);
  expect(out.map((e) => e.subject)).toEqual(['newest', 'middle', 'oldest']);
});

test('fetchEnvelopes applies the limit to the newest window', async () => {
  const messages = {
    1: msg(1, 'oldest', '2026-01-01'),
    2: msg(2, 'middle', '2026-01-02'),
    3: msg(3, 'newest', '2026-01-03'),
  };
  const c = fakeImap({ uids: [1, 2, 3], messages });
  const out = await fetchEnvelopes(c, { all: true }, 2);

  expect(c.calls.fetch[0].range).toEqual([3, 2]);
  expect(out.map((e) => e.subject)).toEqual(['newest', 'middle']);
});

test('fetchEnvelopes handles an empty folder without fetching', async () => {
  const c = fakeImap({ uids: [] });
  const out = await fetchEnvelopes(c, { all: true }, 50);
  expect(out).toEqual([]);
  expect(c.calls.fetch).toHaveLength(0);
});
