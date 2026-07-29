import { test, expect } from '@jest/globals';
import { filterEmails } from '../src/domain/filter.js';

const sample = [
  { from: { name: 'Tally', addr: 'info@tallysolutions.com' }, subject: 'Invoice 1', hasAttachment: true, flags: [] },
  { from: { name: 'Bob', addr: 'bob@acme.com' }, subject: 'Hello', hasAttachment: false, flags: ['\\Seen'] },
];

test('filter by sender substring (name or addr)', () => {
  expect(filterEmails(sample, { from: 'tally' }).length).toBe(1);
  expect(filterEmails(sample, { from: 'acme.com' }).length).toBe(1);
});

test('filter by hasAttachment', () => {
  expect(filterEmails(sample, { hasAttachment: true }).length).toBe(1);
  expect(filterEmails(sample, { hasAttachment: false }).length).toBe(1);
});

test('filter by seen flag', () => {
  expect(filterEmails(sample, { seen: true }).length).toBe(1);
  expect(filterEmails(sample, { seen: false }).length).toBe(1);
});

test('filter by subject substring', () => {
  expect(filterEmails(sample, { subject: 'invoice' }).length).toBe(1);
});

test('empty criteria returns all', () => {
  expect(filterEmails(sample, {}).length).toBe(2);
});

test('combined criteria are AND-ed', () => {
  expect(filterEmails(sample, { from: 'tally', hasAttachment: true }).length).toBe(1);
  expect(filterEmails(sample, { from: 'tally', hasAttachment: false }).length).toBe(0);
});
