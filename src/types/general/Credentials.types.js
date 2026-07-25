// @ts-check
/**
 * @typedef {Object} ImapCredentials
 * @property {string} host
 * @property {number} [port]
 * @property {string} user
 * @property {string} pass
 * @property {boolean} [tls]
 */

/**
 * @typedef {Object} SmtpCredentials
 * @property {string} [host]
 * @property {number} [port]
 * @property {string} [user]
 * @property {string} [pass]
 * @property {boolean} [secure]
 */

/**
 * A configured account. `address` is the server-resolved mailbox cached as
 * non-secret metadata; secrets live in `imap`/`smtp`.
 * @typedef {Object} Account
 * @property {ImapCredentials} imap
 * @property {SmtpCredentials} [smtp]
 * @property {string} [address]
 */

export {};
