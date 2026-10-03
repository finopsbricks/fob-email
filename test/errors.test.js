import { test, expect } from '@jest/globals';

import { describeError } from '../src/cli/_helpers.js';

test('a failed sign-in names the server reason, app passwords and the docs anchor', () => {
  const err = Object.assign(new Error('Command failed'), {
    authenticationFailed: true,
    responseText: 'Invalid credentials (Failure)',
    serverResponseCode: 'AUTHENTICATIONFAILED',
  });
  const msg = describeError(err);
  expect(msg).toMatch(/^Sign-in failed \(Invalid credentials \(Failure\)\)/);
  expect(msg).toMatch(/app password/);
  expect(msg).toMatch(/troubleshooting#sign-in-fails$/);
});

test('network errors keep the system message and link connection troubleshooting', () => {
  const err = Object.assign(new Error('getaddrinfo ENOTFOUND imap.example.invalid'), { code: 'ENOTFOUND' });
  expect(describeError(err)).toBe(
    'getaddrinfo ENOTFOUND imap.example.invalid. Check the host name and port. ' +
      'See https://finopsbricks.com/docs/email/troubleshooting#connection-errors',
  );
});

test('other errors pass through unchanged', () => {
  expect(describeError(new Error('Message not found: 12'))).toBe('Message not found: 12');
});
