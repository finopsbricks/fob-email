import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  toCapabilitySet,
  deriveProvider,
  deriveThreadStrategy,
  deriveProfile,
} from '../src/engine/capabilities.js';

test('toCapabilitySet normalizes Map/array/Set to an uppercased Set', () => {
  assert.ok(toCapabilitySet(new Map([['x-gm-ext-1', true]])).has('X-GM-EXT-1'));
  assert.ok(toCapabilitySet(['move']).has('MOVE'));
  assert.ok(toCapabilitySet(new Set(['idle'])).has('IDLE'));
  assert.equal(toCapabilitySet(null).size, 0);
});

test('deriveProvider names known hosts, falls back to generic', () => {
  assert.equal(deriveProvider('imap.gmail.com', new Set()), 'gmail');
  assert.equal(deriveProvider('outlook.office365.com', new Set()), 'outlook');
  assert.equal(deriveProvider('imap.fastmail.com', new Set()), 'fastmail');
  assert.equal(deriveProvider('imap.mail.yahoo.com', new Set()), 'yahoo');
  assert.equal(deriveProvider('mail.acme.com', new Set()), 'generic');
  // Gmail also confirmable by extension when the host is opaque
  assert.equal(deriveProvider('mx.internal', new Set(['X-GM-EXT-1'])), 'gmail');
});

test('deriveThreadStrategy → thread-id when a thread id is available (Gmail or OBJECTID), else reconstruct', () => {
  assert.equal(deriveThreadStrategy(new Set(['X-GM-EXT-1'])), 'thread-id');
  assert.equal(deriveThreadStrategy(new Set(['OBJECTID'])), 'thread-id');
  assert.equal(deriveThreadStrategy(new Set(['THREAD=REFERENCES'])), 'reconstruct'); // no imapflow THREAD cmd
  assert.equal(deriveThreadStrategy(new Set(['MOVE', 'IDLE'])), 'reconstruct');
});

test('deriveProfile combines address + provider + strategy', () => {
  const p = deriveProfile({
    host: 'imap.gmail.com',
    capabilities: new Map([['X-GM-EXT-1', true]]),
    address: 'me@gmail.com',
  });
  assert.deepEqual(p, { address: 'me@gmail.com', provider: 'gmail', threadStrategy: 'thread-id' });
});

test('deriveProfile on a plain server without a thread id → reconstruct', () => {
  const p = deriveProfile({
    host: 'mail.acme.com',
    capabilities: ['IMAP4rev1', 'MOVE'],
    address: 'ops@acme.com',
  });
  assert.deepEqual(p, { address: 'ops@acme.com', provider: 'generic', threadStrategy: 'reconstruct' });
});
