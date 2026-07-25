/**
 * Shared yargs helpers for the fob-email CLI.
 */

/**
 * Wrap a handler so unexpected exceptions exit cleanly without a stack trace.
 * Set FOB_DEBUG=1 to see the full stack.
 */
export function safe(handler) {
  return async (argv) => {
    try {
      await handler(argv);
    } catch (err) {
      console.error(`Error: ${err.message}`);
      if (process.env.FOB_DEBUG) console.error(err.stack);
      process.exit(1);
    }
  };
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
