// @ts-check
/**
 * An IMAP folder (a.k.a. mailbox in the protocol; we say "folder" to avoid
 * colliding with the user's "mailbox = account" mental model).
 * @typedef {Object} Folder
 * @property {string} path        full hierarchical path (e.g. "Invoices/2026")
 * @property {string} name        leaf name
 * @property {string|null} specialUse  e.g. "\\Sent", "\\Drafts", "\\Trash"
 * @property {boolean} subscribed
 * @property {boolean} [selectable] false for `\Noselect` hierarchy containers
 *   (e.g. Gmail's "[Gmail]"), which LIST returns but SELECT rejects.
 */

export {};
