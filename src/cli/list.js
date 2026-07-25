import { listEmails } from '../index.js';
import { emitJson } from './_helpers.js';

/** `fob-email list` — envelopes for a folder, newest first, as JSON. */
export async function listHandler(argv) {
  emitJson(
    await listEmails({
      account: argv.account,
      folder: argv.folder,
      unseenOnly: argv.unseen,
      limit: argv.limit,
    }),
  );
}
