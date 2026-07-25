// @ts-check
/**
 * @typedef {import('./Attachment.types.js').Attachment} Attachment
 */

/**
 * @typedef {Object} Address
 * @property {string|null} name
 * @property {string|null} addr
 */

/**
 * A message envelope — one `list`/`search` row (metadata, no body).
 * @typedef {Object} Envelope
 * @property {number} id            per-folder IMAP UID
 * @property {string|null} messageId
 * @property {Address|null} from
 * @property {Address|null} to
 * @property {string} subject
 * @property {string|null} date     ISO 8601
 * @property {string[]} flags
 * @property {boolean} hasAttachment
 */

/**
 * A full message — one `get` result (parsed body + attachment metadata).
 * @typedef {Object} Email
 * @property {number} id
 * @property {string|null} messageId
 * @property {Address|null} from
 * @property {Array<Address|null>} to
 * @property {string} subject
 * @property {string|null} date
 * @property {string} text
 * @property {string|null} html
 * @property {Attachment[]} attachments
 */

export {};
