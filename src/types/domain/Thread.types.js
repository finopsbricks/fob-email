// @ts-check
/**
 * @typedef {import('./Email.types.js').Envelope} Envelope
 */

/**
 * A thread summary — one `threads list` row.
 * @typedef {Object} ThreadSummary
 * @property {string} id        server thread id, or the reconstructed root message-id
 * @property {number} count     messages in the thread (within the scanned window)
 * @property {string} subject   the latest message's subject
 * @property {Envelope} latest  the most recent message
 */

/**
 * A full thread — one `threads show` result (conversation, oldest→newest).
 * @typedef {Object} Thread
 * @property {string} id
 * @property {Envelope[]} messages
 */

export {};
