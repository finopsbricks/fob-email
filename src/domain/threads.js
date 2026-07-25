// @ts-check
/**
 * Pure thread-grouping (the `reconstruct` strategy's core) — no I/O.
 *
 * Given message nodes carrying their `Message-Id` and the ids they reference
 * (`References` + `In-Reply-To`), connect them into conversations by union-find:
 * a message joins the thread of every id it references, transitively. This is
 * what runs when the server offers no thread id (D6 `reconstruct`); the
 * `thread-id` strategy groups by the server's id and never reaches here.
 */

/**
 * Extract `<...>` message-id tokens from a References / In-Reply-To header value.
 * @param {string|null|undefined} value
 * @returns {string[]}
 */
export function parseMessageIds(value) {
  if (!value) return [];
  return String(value).match(/<[^>]+>/g) ?? [];
}

/** @param {{date?: string|null}} a @param {{date?: string|null}} b */
function byDateAsc(a, b) {
  return new Date(a.date || 0).getTime() - new Date(b.date || 0).getTime();
}

/**
 * Group message nodes into threads. Each node: `{ id, messageId, refs, date }`.
 * Returns an array of threads, each a node array sorted oldest→newest.
 * @param {Array<{ id: number, messageId?: string|null, refs?: string[], date?: string|null }>} nodes
 */
export function groupThreads(nodes) {
  /** @type {Map<string,string>} */
  const parent = new Map();
  const find = (x) => {
    if (!parent.has(x)) parent.set(x, x);
    let root = x;
    while (parent.get(root) !== root) root = /** @type {string} */ (parent.get(root));
    let cur = x;
    while (parent.get(cur) !== root) {
      const next = /** @type {string} */ (parent.get(cur));
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  const keyOf = (n) => n.messageId || `uid:${n.id}`;
  for (const n of nodes) {
    const self = keyOf(n);
    find(self);
    for (const ref of n.refs || []) union(self, ref);
  }

  /** @type {Map<string, any[]>} */
  const groups = new Map();
  for (const n of nodes) {
    const root = find(keyOf(n));
    if (!groups.has(root)) groups.set(root, []);
    /** @type {any[]} */ (groups.get(root)).push(n);
  }
  return [...groups.values()].map((g) => g.slice().sort(byDateAsc));
}

/**
 * The thread (oldest→newest) containing `targetId`, or `[]` if not found.
 * @param {Array<{ id: number, messageId?: string|null, refs?: string[], date?: string|null }>} nodes
 * @param {number} targetId
 */
export function threadOf(nodes, targetId) {
  return groupThreads(nodes).find((g) => g.some((n) => n.id === targetId)) ?? [];
}
