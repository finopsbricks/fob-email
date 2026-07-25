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

/**
 * A fake email client for handler tests: records calls, returns canned data,
 * tracks close(). Pass canned results per method; every call is recorded on
 * `.calls` for assertions.
 */
export function fakeClient(canned = {}) {
  const calls = {
    list: [], search: [], get: [], download: [], mark: [], move: [], delete: [], send: [],
    folders: { list: [], create: [], rename: [], delete: [] },
    closed: 0,
  };
  const ret = (v, fallback) => (v !== undefined ? v : fallback);
  return {
    calls,
    emails: {
      list: async (opts) => (calls.list.push(opts), ret(canned.list, { data: [], uidValidity: 1, folder: opts?.folder ?? 'INBOX' })),
      search: async (opts) => (calls.search.push(opts), ret(canned.search, { data: [], uidValidity: 1, folder: opts?.folder ?? 'INBOX' })),
      get: async (id, opts) => (calls.get.push({ id, opts }), ret(canned.get, null)),
      download: async (id, opts) => (calls.download.push({ id, opts }), ret(canned.download, [])),
      mark: async (id, seen, opts) => (calls.mark.push({ id, seen, opts }), ret(canned.mark, { id, flag: '\\Seen', on: seen })),
      move: async (id, to, opts) => (calls.move.push({ id, to, opts }), ret(canned.move, { id, to })),
      delete: async (id, opts) => (calls.delete.push({ id, opts }), ret(canned.delete, { id, deleted: true })),
      send: async (message) => (calls.send.push(message), ret(canned.send, { messageId: '<sent@x>', accepted: message.to, rejected: [] })),
    },
    folders: {
      list: async () => (calls.folders.list.push(true), ret(canned.foldersList, [])),
      create: async (name) => (calls.folders.create.push(name), ret(canned.folderResult, { path: name, created: true })),
      rename: async (name, to) => (calls.folders.rename.push({ name, to }), ret(canned.folderResult, { from: name, to })),
      delete: async (name) => (calls.folders.delete.push(name), ret(canned.folderResult, { path: name, deleted: true })),
    },
    close: async () => {
      calls.closed += 1;
    },
  };
}
