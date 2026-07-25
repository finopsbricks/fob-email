// @ts-check
import { clientFor } from '../_helpers.js';
import { formatTable } from '../../utils/format.js';

/**
 * `fob-email folders list` — all folders with metadata.
 * @param {any} argv
 * @param {any} [mbox] injected client (tests); defaults to `clientFor(argv)`.
 */
export async function listFoldersHandler(argv, mbox) {
  const client = mbox ?? clientFor(argv);
  try {
    const folders = await client.folders.list();
    if (argv.json) {
      console.log(JSON.stringify(folders, null, 2));
      return;
    }
    if (folders.length === 0) {
      console.log('(no folders)');
      return;
    }
    const rows = folders.map((f) => [f.path, f.specialUse ?? '', f.subscribed ? 'yes' : '']);
    console.log(formatTable(['PATH', 'SPECIAL', 'SUBSCRIBED'], rows));
  } finally {
    await client.close();
  }
}
