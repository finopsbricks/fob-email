// @ts-check
/**
 * The `emails` resource — every email object-operation, defined once.
 *
 * `buildEmails(ctx)` binds the transport seam (engine/transport.js) into a flat
 * namespace. This is what `fobEmail(account).emails` is, and the single place
 * email operations live — the CLI handlers call these and hold no protocol
 * knowledge of their own.
 *
 * Return shapes: `list`/`search` return the `{ data, uidValidity, folder }`
 * envelope (the CLI round-trips `uidValidity` into later write ops per D4);
 * `get` returns the full parsed message; mutations return a small result object.
 */

/**
 * @typedef {import('../types/general/index.js').Transport} Transport
 * @typedef {import('../types/domain/Email.types.js').Envelope} Envelope
 * @typedef {import('../types/domain/Email.types.js').Email} Email
 * @typedef {import('../types/domain/Attachment.types.js').Attachment} Attachment
 */

/**
 * The emails client surface. Declared (not inferred) because `checkJs` treats an
 * inferred object literal as expando — only a declared type gives callers real
 * checking, and `buildEmails`'s `@returns` binds it so `tsc` verifies the impl.
 * @typedef {Object} EmailsApi
 * @property {(opts?: object) => Promise<{ data: Envelope[], uidValidity: number|null, folder: string }>} list
 * @property {(opts?: object) => Promise<{ data: Envelope[], uidValidity: number|null, folder: string }>} search
 * @property {(id: number, opts?: object) => Promise<Email>} get
 * @property {(id: number, opts?: object) => Promise<Attachment[]>} download
 * @property {(id: number, seen: boolean, opts?: object) => Promise<any>} mark
 * @property {(id: number, to: string, opts?: object) => Promise<any>} move
 * @property {(id: number, opts?: object) => Promise<any>} delete
 * @property {(message: object) => Promise<any>} send
 */

/**
 * @param {Transport} ctx
 * @returns {EmailsApi}
 */
export function buildEmails(ctx) {
  return {
    /** One window of envelopes, newest first. Returns `{ data, uidValidity, folder }`. */
    list: (opts = {}) => ctx.list(opts),

    /** IMAP SEARCH (keyword/header/date — no semantic). Same shape as `list`. */
    search: (opts = {}) => ctx.search(opts),

    /** One full message by id. `opts` carries `folder` (and optional `uidValidity`). */
    get: (id, opts = {}) => ctx.fetchFull({ id, ...opts }),

    /** A message's attachments with content buffers (for download). */
    download: (id, opts = {}) => ctx.fetchAttachments({ id, ...opts }),

    /** Set/clear the `\\Seen` flag. `seen=true` marks read, `false` marks unread. */
    mark: (id, seen, opts = {}) => ctx.setFlag({ id, flag: '\\Seen', on: seen, ...opts }),

    /** Move a message to another folder. */
    move: (id, to, opts = {}) => ctx.move({ id, to, ...opts }),

    /** Permanently delete a message. */
    delete: (id, opts = {}) => ctx.expunge({ id, ...opts }),

    /** Send a message (SMTP). `message` is the CLI's normalized message object. */
    send: (message) => ctx.send(message),
  };
}
