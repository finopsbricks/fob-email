// @ts-check
import { clientFor } from '../_helpers.js';

/**
 * `fob-email sync clear --yes` — drop mirrored data.
 *
 * Requires `--yes` for consistency with `folders delete`, but the stakes are far
 * lower and the message says so: this deletes only the local copy. Nothing on
 * the server is touched (D7 — sync never pushes), so the worst case is that the
 * next read is slow again. That disposability is what makes `clear` the
 * always-safe answer to a mirror suspected of being wrong.
 *
 * @param {any} argv
 * @param {any} [mbox] injected client (tests); defaults to `clientFor(argv)`.
 */
export async function syncClearHandler(argv, mbox) {
  if (!argv.yes) {
    const scope = argv.folder ? `folder ${argv.folder}` : 'every folder';
    throw new Error(
      `Refusing to clear the local mirror for ${scope} without --yes. ` +
        '(This deletes only local data — your mail is untouched and can be re-synced.)',
    );
  }

  const client = mbox ?? clientFor(argv);
  try {
    const result = await client.sync.clear({ folder: argv.folder });
    if (argv.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    const scope = result.folder ?? 'all folders';
    console.log(`Cleared ${result.cleared} mirrored message(s) for ${scope}. Re-run \`sync run\` to rebuild.`);
  } finally {
    await client.close();
  }
}
