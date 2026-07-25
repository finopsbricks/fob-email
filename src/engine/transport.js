import { connectSession } from './imap.js';
import { connectMailer } from './smtp.js';

/**
 * The transport seam — `createTransport(account)` is the protocol analog of an
 * HTTP client's `createTransport`. It binds one account's credentials into a
 * flat `ctx` of primitive protocol ops that the `src/resources/` layer composes
 * into user-facing verbs. Resources never import the engine factories directly
 * and hold no protocol knowledge of their own — this is the only seam they bind to.
 *
 * Connections are lazy and reused: the IMAP session opens on the first mailbox
 * op, the SMTP mailer on the first `send`, and `close()` tears both down. A
 * client built from this ctx (see src/index.js `fobEmail`) is therefore cheap to
 * construct and must be closed by the caller (or via the one-shot helpers).
 *
 * @param {string|object} [account] account name, or a raw config object.
 */
export function createTransport(account) {
  /** @type {ReturnType<typeof connectSession>|null} */
  let imap = null;
  /** @type {ReturnType<typeof connectMailer>|null} */
  let smtp = null;

  const session = () => (imap ??= connectSession(account));
  const mailer = () => (smtp ??= connectMailer(account));

  return {
    // -- reads ----------------------------------------------------------------
    /** @param {object} [opts] */
    list: async (opts) => (await session()).list(opts),
    /** @param {object} [opts] */
    search: async (opts) => (await session()).search(opts),
    /** @param {object} opts */
    fetchFull: async (opts) => (await session()).fetchFull(opts),
    /** @param {object} opts */
    fetchAttachments: async (opts) => (await session()).fetchAttachments(opts),
    /** @returns {Promise<Array<object>>} */
    listFolders: async () => (await session()).listFolders(),

    // -- message mutations (all id-targeting; carry folder + uidValidity) -----
    /** @param {object} opts */
    setFlag: async (opts) => (await session()).setFlag(opts),
    /** @param {object} opts */
    move: async (opts) => (await session()).move(opts),
    /** @param {object} opts */
    expunge: async (opts) => (await session()).expunge(opts),

    // -- folder mutations -----------------------------------------------------
    /** @param {string} name */
    createFolder: async (name) => (await session()).createFolder(name),
    /** @param {string} name @param {string} to */
    renameFolder: async (name, to) => (await session()).renameFolder(name, to),
    /** @param {string} name */
    deleteFolder: async (name) => (await session()).deleteFolder(name),

    // -- send -----------------------------------------------------------------
    /** @param {object} message */
    send: async (message) => (await mailer()).send(message),

    /** Tear down whichever connections were opened. */
    close: async () => {
      if (imap) await (await imap).close();
      if (smtp) await (await smtp).close();
    },
  };
}
