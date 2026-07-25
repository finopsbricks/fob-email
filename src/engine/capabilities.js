// @ts-check
/**
 * Deterministic capability derivation (D6) — pure functions, no I/O.
 *
 * Given the IMAP CAPABILITY set (free after connect) and the host, decide the
 * account's `provider` and `thread_strategy` once. `probe()` on the session
 * feeds these; `config accounts add`/`refresh` cache the result on the profile so
 * runtime dispatches from the cache instead of a per-call cascade.
 */

/**
 * @typedef {import('../types/domain/Capabilities.types.js').Provider} Provider
 * @typedef {import('../types/domain/Capabilities.types.js').ThreadStrategy} ThreadStrategy
 */

/** Normalize a capability list (Set/Map/array) to an uppercased string Set. */
export function toCapabilitySet(capabilities) {
  if (!capabilities) return new Set();
  const keys =
    capabilities instanceof Map
      ? [...capabilities.keys()]
      : Array.isArray(capabilities)
        ? capabilities
        : [...capabilities];
  return new Set(keys.map((k) => String(k).toUpperCase()));
}

/**
 * Name the provider from the host, with Gmail also confirmable via its extension.
 * @param {string} host
 * @param {Set<string>} caps
 * @returns {Provider}
 */
export function deriveProvider(host = '', caps = new Set()) {
  const h = String(host).toLowerCase();
  if (h.includes('gmail') || h.includes('googlemail') || caps.has('X-GM-EXT-1')) return 'gmail';
  if (h.includes('outlook') || h.includes('office365') || h.includes('hotmail') || h.includes('live.com')) {
    return 'outlook';
  }
  if (h.includes('fastmail') || h.includes('messagingengine')) return 'fastmail';
  if (h.includes('yahoo') || h.includes('ymail')) return 'yahoo';
  return 'generic';
}

/**
 * Pick the thread-resolution strategy from advertised capabilities.
 *
 * `thread-id`: the server hands us a stable per-message thread id we can fetch
 * and search — Gmail (`X-GM-EXT-1`) or RFC 8474 (`OBJECTID`). imapflow abstracts
 * both behind the same `threadId` fetch/search field, so they share one path.
 * `reconstruct`: no thread id — walk `References`/`In-Reply-To` client-side.
 * (imapflow has no RFC 5256 `THREAD` command, so there is no server-side
 * reconstruct path to prefer.)
 * @param {Set<string>} caps
 * @returns {ThreadStrategy}
 */
export function deriveThreadStrategy(caps = new Set()) {
  if (caps.has('X-GM-EXT-1') || caps.has('OBJECTID')) return 'thread-id';
  return 'reconstruct';
}

/**
 * Derive the self-describing profile fields from a probe.
 * @param {{ host?: string, capabilities?: any, address?: string|null }} input
 * @returns {{ address: string|null, provider: Provider, threadStrategy: ThreadStrategy }}
 */
export function deriveProfile({ host = '', capabilities, address = null } = {}) {
  const caps = toCapabilitySet(capabilities);
  return {
    address: address ?? null,
    provider: deriveProvider(host, caps),
    threadStrategy: deriveThreadStrategy(caps),
  };
}
