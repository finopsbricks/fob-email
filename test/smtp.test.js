import { test, expect } from '@jest/globals';

import { connectMailer } from '../src/engine/smtp.js';

test('sending without an SMTP host fails clearly instead of trying the IMAP host', async () => {
  const account = { imap: { host: 'imap.gmail.com', user: 'me@gmail.com', pass: 'app-pw' } };
  await expect(connectMailer(account)).rejects.toThrow(/Sending needs an SMTP server, and this account has none/);
  await expect(connectMailer(account)).rejects.toThrow(/--smtp-host/);
});
