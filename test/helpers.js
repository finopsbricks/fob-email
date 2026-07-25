/**
 * Test harness for CLI handlers: capture stdout/stderr and turn process.exit
 * into a throw so a handler that exits halts and the test can assert on it.
 * The node:test analog of the standard's Jest `captureOutput()`.
 */

export class ExitError extends Error {
  constructor(code) {
    super(`process.exit called with code ${code}`);
    this.code = code;
  }
}

export function captureOutput() {
  const lines = { stdout: [], stderr: [] };
  const orig = { log: console.log, error: console.error, exit: process.exit };

  console.log = (...a) => lines.stdout.push(a.join(' '));
  console.error = (...a) => lines.stderr.push(a.join(' '));
  process.exit = (code) => {
    throw new ExitError(code ?? 0);
  };

  return {
    get stdout() {
      return lines.stdout.join('\n');
    },
    get stderr() {
      return lines.stderr.join('\n');
    },
    restore() {
      console.log = orig.log;
      console.error = orig.error;
      process.exit = orig.exit;
    },
  };
}

/** A fake email client for handler tests: records calls, returns canned data, tracks close(). */
export function fakeClient({ list, get } = {}) {
  const calls = { list: [], get: [], closed: 0 };
  return {
    calls,
    emails: {
      list: async (opts) => {
        calls.list.push(opts);
        return list ?? { data: [], uidValidity: 1, folder: opts?.folder ?? 'INBOX' };
      },
      get: async (id, opts) => {
        calls.get.push({ id, opts });
        return get ?? null;
      },
    },
    close: async () => {
      calls.closed += 1;
    },
  };
}
