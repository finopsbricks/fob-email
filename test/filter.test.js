import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterEmails } from '../src/domain/filter.js';

const sample = [
  { from: { name: 'Tally', addr: 'info@tallysolutions.com' }, subject: 'Invoice 1', hasAttachment: true, flags: [] },
  { from: { name: 'Bob', addr: 'bob@acme.com' }, subject: 'Hello', hasAttachment: false, flags: ['\\Seen'] },
];

test('filter by sender substring (name or addr)', () => {
  assert.equal(filterEmails(sample, { from: 'tally' }).length, 1);
  assert.equal(filterEmails(sample, { from: 'acme.com' }).length, 1);
});

test('filter by hasAttachment', () => {
  assert.equal(filterEmails(sample, { hasAttachment: true }).length, 1);
  assert.equal(filterEmails(sample, { hasAttachment: false }).length, 1);
});

test('filter by seen flag', () => {
  assert.equal(filterEmails(sample, { seen: true }).length, 1);
  assert.equal(filterEmails(sample, { seen: false }).length, 1);
});

test('filter by subject substring', () => {
  assert.equal(filterEmails(sample, { subject: 'invoice' }).length, 1);
});

test('empty criteria returns all', () => {
  assert.equal(filterEmails(sample, {}).length, 2);
});

test('combined criteria are AND-ed', () => {
  assert.equal(filterEmails(sample, { from: 'tally', hasAttachment: true }).length, 1);
  assert.equal(filterEmails(sample, { from: 'tally', hasAttachment: false }).length, 0);
});
