// @ts-check
/**
 * The `threads` resource — conversations, defined once.
 *
 * `buildThreads(ctx)` binds the transport seam into a flat namespace. The
 * resolution strategy is a property of the account (D6) — read from the cached
 * profile inside the engine — so this layer stays strategy-agnostic: it just
 * asks for a thread and gets one back.
 */

/**
 * @typedef {import('../types/general/index.js').Transport} Transport
 * @typedef {import('../types/domain/Thread.types.js').ThreadSummary} ThreadSummary
 * @typedef {import('../types/domain/Thread.types.js').Thread} Thread
 */

/**
 * The threads client surface (declared so `checkJs` checks callers).
 * @typedef {Object} ThreadsApi
 * @property {(opts?: object) => Promise<ThreadSummary[]>} list
 * @property {(id: number, opts?: object) => Promise<Thread>} show
 */

/**
 * @param {Transport} ctx
 * @returns {ThreadsApi}
 */
export function buildThreads(ctx) {
  return {
    /** Conversations in a folder, newest activity first. */
    list: (opts = {}) => ctx.listThreads(opts),

    /** The full conversation containing message `id` (oldest→newest). */
    show: (id, opts = {}) => ctx.resolveThread({ id, ...opts }),
  };
}
