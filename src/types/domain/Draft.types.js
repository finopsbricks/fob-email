// @ts-check
/**
 * The result of a draft write (create/edit). IMAP messages are immutable, so an
 * `edit` is append-new + delete-old — `id` is the *new* draft's id.
 * @typedef {Object} DraftRef
 * @property {number|null} id     new draft UID (null if the server lacks UIDPLUS)
 * @property {string} folder      the Drafts folder it was written to
 * @property {number|null} [uidValidity]
 */

export {};
