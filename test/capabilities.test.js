import { test, expect } from '@jest/globals';

import {
  toCapabilitySet,
  deriveProvider,
  deriveThreadStrategy,
  deriveProfile,
} from '../src/engine/capabilities.js';

test('toCapabilitySet normalizes Map/array/Set to an uppercased Set', () => {
  expect(toCapabilitySet(new Map([['x-gm-ext-1', true]])).has('X-GM-EXT-1')).toBeTruthy();
  expect(toCapabilitySet(['move']).has('MOVE')).toBeTruthy();
  expect(toCapabilitySet(new Set(['idle'])).has('IDLE')).toBeTruthy();
  expect(toCapabilitySet(null).size).toBe(0);
});

test('deriveProvider names known hosts, falls back to generic', () => {
  expect(deriveProvider('imap.gmail.com', new Set())).toBe('gmail');
  expect(deriveProvider('outlook.office365.com', new Set())).toBe('outlook');
  expect(deriveProvider('imap.fastmail.com', new Set())).toBe('fastmail');
  expect(deriveProvider('imap.mail.yahoo.com', new Set())).toBe('yahoo');
  expect(deriveProvider('mail.acme.com', new Set())).toBe('generic');
  // Gmail also confirmable by extension when the host is opaque
  expect(deriveProvider('mx.internal', new Set(['X-GM-EXT-1']))).toBe('gmail');
});

test('deriveThreadStrategy → thread-id when a thread id is available (Gmail or OBJECTID), else reconstruct', () => {
  expect(deriveThreadStrategy(new Set(['X-GM-EXT-1']))).toBe('thread-id');
  expect(deriveThreadStrategy(new Set(['OBJECTID']))).toBe('thread-id');
  expect(deriveThreadStrategy(new Set(['THREAD=REFERENCES']))).toBe('reconstruct'); // no imapflow THREAD cmd
  expect(deriveThreadStrategy(new Set(['MOVE', 'IDLE']))).toBe('reconstruct');
});

test('deriveProfile combines address + provider + strategy', () => {
  const p = deriveProfile({
    host: 'imap.gmail.com',
    capabilities: new Map([['X-GM-EXT-1', true]]),
    address: 'me@gmail.com',
  });
  expect(p).toEqual({ address: 'me@gmail.com', provider: 'gmail', threadStrategy: 'thread-id' });
});

test('deriveProfile on a plain server without a thread id → reconstruct', () => {
  const p = deriveProfile({
    host: 'mail.acme.com',
    capabilities: ['IMAP4rev1', 'MOVE'],
    address: 'ops@acme.com',
  });
  expect(p).toEqual({ address: 'ops@acme.com', provider: 'generic', threadStrategy: 'reconstruct' });
});
