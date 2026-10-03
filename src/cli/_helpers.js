/**
 * Shared yargs helpers for the fob-email CLI.
 */

import { fobEmail } from '../index.js';
import { TROUBLESHOOTING_DOCS_URL } from '../links.js';

/**
 * Build an email client for the command's `--account` (or the default account).
 * The presentation layer's single seam to the resource layer — handlers call
 * `clientFor(argv).emails.*` and must `close()` it (a `finally`).
 * @param {{ account?: string }} [argv]
 */
export function clientFor(argv = {}) {
  return fobEmail(argv.account);
}

const CONNECTION_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET', 'EHOSTUNREACH']);

/**
 * A one-line, human-readable description of an error. imapflow reports a
 * failed sign-in as a bare "Command failed" with the server's reason in
 * `responseText`, so that case is spelled out and linked to the docs, as are
 * network errors (host not found, refused, timed out).
 * @param {any} err
 */
export function describeError(err) {
  if (err?.authenticationFailed) {
    const reason = err.responseText || err.serverResponseCode || err.message;
    return (
      `Sign-in failed (${reason}). Most providers need an app password, not your normal password. ` +
      `See ${TROUBLESHOOTING_DOCS_URL}#sign-in-fails`
    );
  }
  if (CONNECTION_CODES.has(err?.code)) {
    return `${err.message}. Check the host name and port. See ${TROUBLESHOOTING_DOCS_URL}#connection-errors`;
  }
  return err?.message ?? String(err);
}

/**
 * Wrap a handler so unexpected exceptions exit cleanly without a stack trace.
 * Set FOB_DEBUG=1 to see the full stack.
 */
export function safe(handler) {
  return async (argv) => {
    try {
      await handler(argv);
    } catch (err) {
      console.error(`Error: ${describeError(err)}`);
      if (process.env.FOB_DEBUG) console.error(err.stack);
      process.exit(1);
    }
  };
}

/**
 * Register a command's own "Options:" group so it renders *above* the inherited
 * "Global Options:". yargs merges an instance's groups before the preserved
 * global ones, and otherwise materialises the default "Options:" group last — so
 * pre-creating it on the command instance is what fixes the order. Call at the
 * start of a command's builder; ungrouped options then fall into this group.
 * @param {any} yargs
 */
export function localOptions(yargs) {
  return yargs.group([], 'Options:');
}

/** Emit a value as pretty JSON on stdout — the machine-readable contract. */
export function emitJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

/** Read all of stdin as a UTF-8 string (for the `filter` pipe). */
export async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}
