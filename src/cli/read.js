import { readEmail } from '../index.js';
import { emitJson } from './_helpers.js';

/** `fob-email read <id>` — one full message by UID, as JSON. */
export async function readHandler(argv) {
  emitJson(await readEmail({ account: argv.account, id: Number(argv.id), folder: argv.folder }));
}
