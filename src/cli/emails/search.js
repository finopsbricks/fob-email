// @ts-check
import { clientFor } from '../_helpers.js';
import { emitEnvelopes } from './_envelopes.js';
import { noteStaleness } from './list.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Build an IMAP SEARCH criteria object from the CLI flags. Keyword/header/date
 * only — IMAP has no semantic search (unlike a product like spark).
 * @param {any} argv
 */
function buildCriteria(argv) {
  /** @type {Record<string, any>} */
  const criteria = {};
  if (argv.query) criteria.text = argv.query; // TEXT: whole message (headers + body)
  if (argv.from) criteria.from = argv.from;
  if (argv.subject) criteria.subject = argv.subject;
  if (argv.since) {
    if (!DATE_RE.test(argv.since)) throw new Error('--since must be in YYYY-MM-DD format');
    criteria.since = new Date(argv.since);
  }
  return criteria;
}

/**
 * `fob-email emails search <query>` — IMAP SEARCH over a folder. Same output as
 * `emails list`.
 * @param {any} argv
 * @param {any} [mbox] injected client (tests); defaults to `clientFor(argv)`.
 */
export async function searchEmailsHandler(argv, mbox) {
  const client = mbox ?? clientFor(argv);
  try {
    if (argv.cached) {
      // The mirror holds envelopes only (S2), so a cached search matches
      // from/subject/date — not `--query`, which is IMAP TEXT over the body.
      // Refuse rather than quietly returning a narrower result set than asked.
      if (argv.query) {
        throw new Error(
          'Full-text search needs the server (the local mirror stores envelopes, not bodies). ' +
            'Drop --cached, or search --from/--subject instead.',
        );
      }
      const { data, syncedAt } = client.sync.read({
        folder: argv.folder,
        limit: argv.limit,
        from: argv.from,
        subject: argv.subject,
        since: argv.since ? isoDay(argv.since) : undefined,
      });
      if (!argv.json) noteStaleness(syncedAt);
      emitEnvelopes(data, argv);
      return;
    }

    const criteria = buildCriteria(argv);
    const { data } = await client.emails.search({
      folder: argv.folder,
      criteria: Object.keys(criteria).length ? criteria : { all: true },
      limit: argv.limit,
    });
    emitEnvelopes(data, argv);
  } finally {
    await client.close();
  }
}

/** `YYYY-MM-DD` → an ISO instant, so it compares against stored ISO dates. */
function isoDay(s) {
  if (!DATE_RE.test(s)) throw new Error('--since must be in YYYY-MM-DD format');
  return new Date(`${s}T00:00:00.000Z`).toISOString();
}
