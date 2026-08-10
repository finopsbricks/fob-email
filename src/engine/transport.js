import { connectSession } from './imap.js';
import { connectMailer } from './smtp.js';
import { buildMime } from './mime.js';

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

    // -- sync (server → local only, D7) ---------------------------------------
    /** @param {string} [folder] one STATUS round-trip: uidNext/uidValidity/modseq */
    statusOf: async (folder) => (await session()).statusOf(folder),
    /** @param {object} [opts] envelopes + the window's uid set, for a sync pass */
    fetchForSync: async (opts) => (await session()).fetchForSync(opts),

    // -- threads (strategy read from the profile — D6) ------------------------
    /** @param {object} [opts] */
    listThreads: async (opts) => (await session()).listThreads(opts),
    /** @param {object} opts */
    resolveThread: async (opts) => (await session()).resolveThread(opts),

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

    // -- drafts (compose lifecycle — spans IMAP APPEND + SMTP; MIME built here) -
    /** @returns {Promise<{ data: any[], folder: string }>} */
    listDrafts: async () => (await session()).listDrafts(),
    /** @param {object} message */
    createDraft: async (message) => (await session()).appendDraft(await buildMime(message)),
    /** @param {number} id @param {object} message — append-new then delete-old (immutable IMAP) */
    editDraft: async (id, message) => {
      const s = await session();
      const created = await s.appendDraft(await buildMime(message));
      await s.deleteDraft(id);
      return created;
    },
    /** @param {number} id */
    deleteDraft: async (id) => (await session()).deleteDraft(id),
    /** @param {number} id — fetch the draft's raw source, send it, then delete it */
    sendDraft: async (id) => {
      const s = await session();
      const raw = await s.fetchDraftSource(id);
      const result = await (await mailer()).send({ raw });
      await s.deleteDraft(id);
      return result;
    },

    /** Tear down whichever connections were opened. */
    close: async () => {
      if (imap) await (await imap).close();
      if (smtp) await (await smtp).close();
    },
  };
}
