// @ts-check
/**
 * The server-probed, self-describing part of a profile (D6). Discovered once at
 * `config accounts add`/`refresh` and cached as non-secret metadata, so runtime
 * dispatches from the cache instead of re-probing on every call.
 *
 * Phase 4: `provider` + `threadStrategy` (+ `address`). Phase 6 adds `folders`
 * (special-use paths — the Drafts folder is where `drafts` APPENDs).
 *
 * @typedef {'gmail'|'outlook'|'fastmail'|'yahoo'|'generic'} Provider
 * @typedef {'thread-id'|'reconstruct'} ThreadStrategy
 *
 * @typedef {Object} SpecialFolders
 * @property {string|null} drafts
 * @property {string|null} sent
 * @property {string|null} trash
 * @property {string|null} junk
 * @property {string|null} all
 *
 * @typedef {Object} Capabilities
 * @property {Provider} provider
 * @property {ThreadStrategy} threadStrategy
 * @property {SpecialFolders} [folders]
 */

export {};
