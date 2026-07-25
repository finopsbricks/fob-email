// @ts-check
/**
 * The server-probed, self-describing part of a profile (D6). Discovered once at
 * `config accounts add`/`refresh` and cached as non-secret metadata, so runtime
 * dispatches from the cache instead of re-probing on every call.
 *
 * Phase 4 scope: `provider` + `threadStrategy` (+ `address`, stored alongside).
 * Special-use folders and finer capability flags join in Phase 6 (drafts).
 *
 * @typedef {'gmail'|'outlook'|'fastmail'|'yahoo'|'generic'} Provider
 * @typedef {'thread-id'|'reconstruct'} ThreadStrategy
 *
 * @typedef {Object} Capabilities
 * @property {Provider} provider
 * @property {ThreadStrategy} threadStrategy
 */

export {};
