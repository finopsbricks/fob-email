// @ts-check
import { clientFor } from '../_helpers.js';

/**
 * `fob-email emails mark <id> --read|--unread` — set/clear the read flag.
 * @param {any} argv
 * @param {any} [mbox] injected client (tests); defaults to `clientFor(argv)`.
 */
export async function markEmailHandler(argv, mbox) {
  if (argv.read === argv.unread) {
    throw new Error('Specify exactly one of --read or --unread.');
  }
  const seen = Boolean(argv.read);

  const client = mbox ?? clientFor(argv);
  try {
    const result = await client.emails.mark(Number(argv.id), seen, { folder: argv.folder });
    if (argv.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    console.log(`Marked #${argv.id} as ${seen ? 'read' : 'unread'}.`);
  } finally {
    await client.close();
  }
}
