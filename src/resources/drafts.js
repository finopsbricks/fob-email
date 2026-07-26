// @ts-check
/**
 * The `drafts` resource — the compose lifecycle, defined once.
 *
 * `buildDrafts(ctx)` binds the transport seam into a flat namespace. The Drafts
 * folder and MIME building live behind the ctx (D6 + engine/mime.js); this layer
 * just passes the normalized message object through. `edit` is append-new +
 * delete-old (IMAP messages are immutable), so it returns the new draft ref.
 */

/**
 * @typedef {import('../types/general/index.js').Transport} Transport
 * @typedef {import('../types/domain/Email.types.js').Envelope} Envelope
 * @typedef {import('../types/domain/Draft.types.js').DraftRef} DraftRef
 */

/**
 * The drafts client surface (declared so `checkJs` checks callers).
 * @typedef {Object} DraftsApi
 * @property {() => Promise<{ data: Envelope[], folder: string }>} list
 * @property {(message: object) => Promise<DraftRef>} create
 * @property {(id: number, message: object) => Promise<DraftRef>} edit
 * @property {(id: number) => Promise<any>} delete
 * @property {(id: number) => Promise<any>} send
 */

/**
 * @param {Transport} ctx
 * @returns {DraftsApi}
 */
export function buildDrafts(ctx) {
  return {
    /** Envelopes in the Drafts folder. */
    list: () => ctx.listDrafts(),

    /** Save a new draft (message = the CLI's normalized compose object). */
    create: (message) => ctx.createDraft(message),

    /** Replace draft `id` with a new message (append-new + delete-old). */
    edit: (id, message) => ctx.editDraft(id, message),

    /** Delete a draft. */
    delete: (id) => ctx.deleteDraft(id),

    /** Send a saved draft (SMTP), then remove it from Drafts. */
    send: (id) => ctx.sendDraft(id),
  };
}
