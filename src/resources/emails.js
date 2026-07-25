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
 * `get` returns the full parsed message.
 *
 * Phase 2 ships `list` + `get` (the review-gate slice); `search`/`download`/
 * `mark`/`move`/`delete`/`send` join in Phase 3.
 */

/**
 * @typedef {import('../types/general/index.js').Transport} Transport
 * @typedef {import('../types/domain/Email.types.js').Envelope} Envelope
 * @typedef {import('../types/domain/Email.types.js').Email} Email
 */

/**
 * The emails client surface. Declared (not inferred) because `checkJs` treats an
 * inferred object literal as expando — only a declared type gives callers real
 * checking, and `buildEmails`'s `@returns` binds it so `tsc` verifies the impl.
 * @typedef {Object} EmailsApi
 * @property {(opts?: object) => Promise<{ data: Envelope[], uidValidity: number|null, folder: string }>} list
 * @property {(id: number, opts?: object) => Promise<Email>} get
 */

/**
 * @param {Transport} ctx
 * @returns {EmailsApi}
 */
export function buildEmails(ctx) {
  return {
    /** One window of envelopes, newest first. Returns `{ data, uidValidity, folder }`. */
    list: (opts = {}) => ctx.list(opts),

    /** One full message by id. `opts` carries `folder` (and optional `uidValidity`). */
    get: (id, opts = {}) => ctx.fetchFull({ id, ...opts }),
  };
}
