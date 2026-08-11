import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { resolveAccount } from '../config.js';
import { deriveProfile, mapSpecialFolders } from './capabilities.js';
import { parseMessageIds, groupThreads, threadOf } from '../domain/threads.js';

/**
 * A live IMAP session — the only place that talks IMAP.
 *
 * `connectSession(account)` is a functional factory (WIP decision D5): the live
 * connection lives in a closure variable (truly private — no `this`, no `#`) and
 * the returned object is a flat bag of ops. The transport seam
 * (engine/transport.js) wraps a lazily-connected session so resources never
 * touch the protocol.
 *
 * Message ids are per-folder IMAP UIDs. UIDs are scoped to a folder and
 * invalidated when the folder's UIDVALIDITY changes, so every id-targeting op
 * takes a `folder` and (optionally) the `uidValidity` the id was issued under;
 * `withFolder` throws a clear "stale id" error on mismatch rather than acting on
 * the wrong message (WIP decision D4).
 *
 * @param {string|object} [account] account name, or a raw config object.
 */
export async function connectSession(account) {
  const cfg = resolveAccount(account);
  const client = new ImapFlow({
    host: cfg.imap.host,
    port: cfg.imap.port,
    secure: cfg.imap.tls,
    auth: { user: cfg.imap.user, pass: cfg.imap.pass },
    logger: false,
  });
  await client.connect();
  const address = cfg.imap.user;

  /**
   * Open `folder` under a lock and run `fn(client)`. If `uidValidity` is given,
   * assert it matches the folder's current value first — a mismatch means the
   * caller's ids were issued against a since-reset folder (WIP decision D4).
   */
  const withFolder = async (folder, uidValidity, fn) => {
    const lock = await client.getMailboxLock(folder);
    try {
      if (uidValidity != null) {
        const current = uidValidityOf(client);
        if (current != null && BigInt(current) !== BigInt(uidValidity)) {
          throw new Error(
            `Message id is stale (folder "${folder}" was reset) — re-list the folder to get fresh ids.`,
          );
        }
      }
      return await fn(client);
    } finally {
      lock.release();
    }
  };

  // The thread strategy is a property of the account (D6): read the cached value
  // resolved at `config accounts add`/refresh; if a profile was never probed (or
  // this is a raw config object), derive it once from the live capabilities — a
  // single deterministic decision, never a per-call cascade.
  const strategyFor = () =>
    cfg.threadStrategy ||
    deriveProfile({ host: cfg.imap.host, capabilities: client.capabilities }).threadStrategy;

  // The Drafts folder is a property of the account (D6): read the cached
  // special-use path resolved at add/refresh; fall back to the conventional name.
  const draftsFolder = () => (cfg.folders && cfg.folders.drafts) || 'Drafts';

  return {
    /**
     * The authenticated mailbox — the login user, confirmed by a successful
     * connect(). IMAP has no "whoami"; the login username is the mailbox address
     * for the providers we target, and reaching here means auth passed.
     */
    identity: () => ({ address }),

    /**
     * Probe the server's self-describing profile (D6): provider + thread strategy
     * (from the CAPABILITY set, free after connect) + special-use folders (one
     * `LIST` — the Drafts path drafts APPEND to). Deterministic; `config accounts
     * add`/`refresh` cache the result so runtime never re-probes.
     */
    probe: async () => {
      const base = deriveProfile({ host: cfg.imap.host, capabilities: client.capabilities, address });
      const folders = mapSpecialFolders(await client.list());
      return { ...base, folders };
    },

    /**
     * List envelopes (newest first). Returns the folder's current `uidValidity`
     * alongside the rows so callers can round-trip it into later write ops.
     */
    list: ({ folder = 'INBOX', unseenOnly = false, limit = 50, criteria } = {}) =>
      withFolder(folder, null, async (c) => {
        const query = criteria ?? (unseenOnly ? { seen: false } : { all: true });
        const data = await fetchEnvelopes(c, query, limit);
        return { data, uidValidity: uidValidityOf(c), folder };
      }),

    /**
     * Search a folder with an IMAP SEARCH criteria object (keyword/header/date —
     * no semantic search). Returns envelopes newest-first, same shape as list().
     */
    search: ({ folder = 'INBOX', criteria = { all: true }, limit = 50 } = {}) =>
      withFolder(folder, null, async (c) => {
        const data = await fetchEnvelopes(c, criteria, limit);
        return { data, uidValidity: uidValidityOf(c), folder };
      }),

    /**
     * Did the server *agree* to CONDSTORE? `client.enabled` is the post-ENABLE
     * set, so it reflects what was negotiated rather than what CAPABILITY merely
     * advertised — the distinction that decides whether a modseq cursor can be
     * trusted at all.
     */
    hasCondstore: () => Boolean(client.enabled?.has?.('CONDSTORE')),

    /**
     * A folder's sync cursors, without opening it — one `STATUS` round-trip.
     * `highestModseq` comes back only when the server advertises CONDSTORE; it
     * is a BigInt, stringified here so it survives JSON and SQLite TEXT intact
     * (SQLite INTEGER is signed 64-bit and modseq is unsigned).
     */
    statusOf: async (folder = 'INBOX') => {
      const s = await client.status(folder, {
        uidNext: true,
        uidValidity: true,
        messages: true,
        highestModseq: true,
      });
      return {
        folder,
        uidNext: s?.uidNext == null ? null : Number(s.uidNext),
        uidValidity: s?.uidValidity == null ? null : Number(s.uidValidity),
        messages: s?.messages == null ? null : Number(s.messages),
        highestModseq: s?.highestModseq == null ? null : String(s.highestModseq),
      };
    },

    /**
     * Envelopes for a sync pass, plus the uid set actually present in the window.
     *
     * `sinceUid` fetches only `sinceUid:*` (the incremental path); omitting it
     * walks the whole folder (first sync / `--full`). `limit` caps a first sync
     * to the newest N so a huge mailbox doesn't stall on the initial pull.
     *
     * The `uids` field is what makes vanished-message reconciliation possible:
     * it is the server's current answer for the searched window, so the caller
     * can diff it against mirrored rows. It is **only** meaningful for the range
     * that was actually searched, which is why `windowFrom` is reported back.
     */
    fetchForSync: ({ folder = 'INBOX', sinceUid = null, limit = null } = {}) =>
      withFolder(folder, null, async (c) => {
        const criteria = sinceUid ? { uid: `${sinceUid}:*` } : { all: true };
        let uids = (await c.search(criteria, { uid: true })) || [];

        // An IMAP `uid N:*` range always matches at least the highest existing
        // uid, even when every uid is below N — so a "no new mail" poll comes
        // back with one stale hit. Drop anything below the cursor.
        if (sinceUid) uids = uids.filter((u) => Number(u) >= Number(sinceUid));

        const windowFrom = limit && !sinceUid && uids.length > limit ? Number(uids[uids.length - limit]) : null;
        const pick = limit && !sinceUid ? uids.slice(-limit) : uids;

        const msgs = await fetchByUids(c, pick, {
          uid: true,
          envelope: true,
          flags: true,
          bodyStructure: true,
          threadId: strategyFor() === 'thread-id',
          headers: ['references', 'in-reply-to'],
        });

        return {
          folder,
          uidValidity: uidValidityOf(c),
          // Read from the *open* mailbox, so it is the modseq as of this fetch —
          // the only value safe to store as a delta cursor.
          highestModseq: highestModseqOf(c),
          uids: pick.map(Number),
          windowFrom,
          data: msgs.map((msg) => {
            const env = msg.envelope || {};
            const raw = msg.headers ? msg.headers.toString() : '';
            return {
              ...toEnvelope(msg),
              threadId: msg.threadId ? String(msg.threadId) : null,
              refs: [...parseMessageIds(headerValue(raw, 'references')), ...parseMessageIds(env.inReplyTo)],
            };
          }),
        };
      }),

    /**
     * Flags that changed since `sinceModseq` — one CONDSTORE fetch that returns
     * *only* touched messages, instead of re-reading the whole window.
     *
     * Returns `{ supported: false }` when the server never enabled CONDSTORE, so
     * the caller falls back rather than silently believing an empty delta means
     * "nothing changed".
     */
    fetchFlagChanges: ({ folder = 'INBOX', sinceModseq } = {}) =>
      withFolder(folder, null, async (c) => {
        if (!client.enabled?.has?.('CONDSTORE')) return { supported: false, folder, changes: [] };

        const changes = [];
        for await (const msg of c.fetch(
          { all: true },
          { uid: true, flags: true, modseq: true },
          { uid: true, changedSince: BigInt(sinceModseq) },
        )) {
          changes.push({ id: Number(msg.uid), flags: msg.flags ? [...msg.flags] : [] });
        }
        return { supported: true, folder, uidValidity: uidValidityOf(c), changes };
      }),

    /**
     * Every uid currently in a folder — a bare `SEARCH ALL`, no FETCH.
     *
     * This is how vanished messages are found without QRESYNC. CONDSTORE reports
     * *modified* messages but says nothing about deleted ones, so the only
     * reliable answer is to ask the server which uids still exist and diff. It
     * is one round-trip returning a list of integers, so it stays cheap even on
     * a large folder — far cheaper than re-fetching envelopes to find absences.
     */
    listUids: ({ folder = 'INBOX' } = {}) =>
      withFolder(folder, null, async (c) => ({
        folder,
        uidValidity: uidValidityOf(c),
        uids: ((await c.search({ all: true }, { uid: true })) || []).map(Number),
      })),

    /** Fetch one full message by uid (parsed body + attachment metadata). */
    fetchFull: ({ id, folder = 'INBOX', uidValidity } = {}) =>
      withFolder(folder, uidValidity, async (c) => {
        const msg = await c.fetchOne(id, { uid: true, source: true }, { uid: true });
        if (!msg) throw new Error(`Message not found: ${id}`);
        return toMessage(id, await simpleParser(msg.source));
      }),

    /** Fetch a message's attachments with their content buffers (for download). */
    fetchAttachments: ({ id, folder = 'INBOX', uidValidity } = {}) =>
      withFolder(folder, uidValidity, async (c) => {
        const msg = await c.fetchOne(id, { uid: true, source: true }, { uid: true });
        if (!msg) throw new Error(`Message not found: ${id}`);
        const parsed = await simpleParser(msg.source);
        return (parsed.attachments || []).map((a) => ({
          filename: a.filename || null,
          contentType: a.contentType || null,
          size: a.size ?? null,
          content: a.content,
        }));
      }),

    /** Set or clear a flag (e.g. '\\Seen') on a message. */
    setFlag: ({ id, flag, on, folder = 'INBOX', uidValidity } = {}) =>
      withFolder(folder, uidValidity, async (c) => {
        const ok = on
          ? await c.messageFlagsAdd(id, [flag], { uid: true })
          : await c.messageFlagsRemove(id, [flag], { uid: true });
        if (!ok) throw new Error(`Message not found: ${id}`);
        return { id, flag, on };
      }),

    /** Move a message to another folder. */
    move: ({ id, to, folder = 'INBOX', uidValidity } = {}) =>
      withFolder(folder, uidValidity, async (c) => {
        await c.messageMove(id, to, { uid: true });
        return { id, from: folder, to };
      }),

    /** Permanently delete a message (flag \\Deleted + expunge). */
    expunge: ({ id, folder = 'INBOX', uidValidity } = {}) =>
      withFolder(folder, uidValidity, async (c) => {
        const ok = await c.messageDelete(id, { uid: true });
        if (!ok) throw new Error(`Message not found: ${id}`);
        return { id, deleted: true };
      }),

    /**
     * List conversations in a folder (newest activity first). Groups by the
     * server thread id (`thread-id`) or by reconstructed reference links.
     * Returns thread summaries `{ id, count, subject, latest }`.
     */
    listThreads: ({ folder = 'INBOX', limit = 50 } = {}) =>
      withFolder(folder, null, async (c) => {
        const strategy = strategyFor();
        const all = (await c.search({ all: true }, { uid: true })) || [];
        // Over-sample the window so a thread's older messages are in scope.
        const uids = all.slice(-Math.max(limit * 4, limit));
        const nodes = await fetchThreadNodes(c, uids, strategy === 'thread-id');
        const groups = strategy === 'thread-id' ? groupByThreadId(nodes) : groupThreads(nodes);
        return groups
          .map((g) => {
            const sorted = g.slice().sort(byDateAscNode);
            const latest = sorted[sorted.length - 1];
            return {
              id: threadKey(sorted, strategy),
              count: sorted.length,
              subject: latest.envelope.subject,
              latest: latest.envelope,
            };
          })
          .sort((a, b) => new Date(b.latest.date || 0).getTime() - new Date(a.latest.date || 0).getTime())
          .slice(0, limit);
      }),

    /**
     * Resolve the full conversation containing message `id` (oldest→newest).
     * `thread-id`: fetch the message's thread id, then search it. `reconstruct`:
     * walk References/In-Reply-To over a window. Returns `{ id, messages }`.
     */
    resolveThread: ({ id, folder = 'INBOX', uidValidity } = {}) =>
      withFolder(folder, uidValidity, async (c) => {
        const strategy = strategyFor();
        if (strategy === 'thread-id') {
          const target = await c.fetchOne(id, { uid: true, threadId: true }, { uid: true });
          if (target && target.threadId) {
            const uids = (await c.search({ threadId: target.threadId }, { uid: true })) || [];
            const nodes = await fetchThreadNodes(c, uids.length ? uids : [id], true);
            return { id: String(target.threadId), messages: nodes.sort(byDateAscNode).map((n) => n.envelope) };
          }
        }
        // reconstruct (or thread-id with no id on the message)
        const uids = ((await c.search({ all: true }, { uid: true })) || []).slice(-500);
        const nodes = await fetchThreadNodes(c, uids, false);
        const group = threadOf(nodes, Number(id));
        const chosen = group.length ? group : nodes.filter((n) => n.id === Number(id));
        return { id: String(id), messages: chosen.map((n) => n.envelope) };
      }),

    // -- drafts (the Drafts folder; IMAP messages are immutable, so `edit` is
    //    append-new + delete-old at the resource layer) -----------------------
    /** Envelopes in the Drafts folder. */
    listDrafts: () =>
      withFolder(draftsFolder(), null, async (c) => ({
        data: await fetchEnvelopes(c, { all: true }, 100),
        folder: draftsFolder(),
      })),

    /** APPEND a raw RFC 822 message to the Drafts folder with the \\Draft flag. */
    appendDraft: async (raw) => {
      const folder = draftsFolder();
      const res = await client.append(folder, raw, ['\\Draft']);
      return { id: res?.uid ?? null, folder, uidValidity: res?.uidValidity ?? null };
    },

    /** Delete a draft by id. */
    deleteDraft: (id) =>
      withFolder(draftsFolder(), null, async (c) => {
        const ok = await c.messageDelete(id, { uid: true });
        if (!ok) throw new Error(`Draft not found: ${id}`);
        return { id, deleted: true };
      }),

    /** Raw source of a draft (for send). */
    fetchDraftSource: (id) =>
      withFolder(draftsFolder(), null, async (c) => {
        const msg = await c.fetchOne(id, { uid: true, source: true }, { uid: true });
        if (!msg) throw new Error(`Draft not found: ${id}`);
        return msg.source;
      }),

    /** List folders with basic metadata. */
    listFolders: async () => {
      const boxes = await client.list();
      return boxes.map((b) => ({
        path: b.path,
        name: b.name,
        specialUse: b.specialUse || null,
        subscribed: b.subscribed ?? false,
        // `\Noselect` marks a pure hierarchy container (Gmail's "[Gmail]"), which
        // LIST returns but SELECT rejects. imapflow folds `\NonExistent` into the
        // same flag, so one check covers both. `sync run --all-folders` needs this
        // to skip them rather than fail on them.
        selectable: !(b.flags?.has?.('\\Noselect') ?? false),
      }));
    },

    /** Create a folder. */
    createFolder: async (name) => {
      await client.mailboxCreate(name);
      return { path: name, created: true };
    },

    /** Rename/move a folder. */
    renameFolder: async (name, to) => {
      await client.mailboxRename(name, to);
      return { from: name, to };
    },

    /** Delete a folder. */
    deleteFolder: async (name) => {
      await client.mailboxDelete(name);
      return { path: name, deleted: true };
    },

    close: async () => {
      try {
        await client.logout();
      } catch {
        /* already gone */
      }
    },
  };
}

/**
 * Fetch `uids` in ONE ranged FETCH and return the messages in the order asked.
 *
 * The server streams `FETCH` responses in its own order, not the order of the
 * requested set, so callers that care about ordering (we always do — listings
 * are newest-first) cannot rely on arrival order. We index by uid on the way in
 * and re-project through `uids` on the way out, which also drops uids the server
 * didn't return (expunged between the SEARCH and the FETCH) without a gap.
 *
 * An empty set short-circuits: `fetch()` with an empty range would either issue
 * a pointless command or resolve a `1:*` range and haul the whole mailbox back.
 */
export async function fetchByUids(c, uids, query) {
  if (!uids.length) return [];
  const byUid = new Map();
  for await (const msg of c.fetch(uids, query, { uid: true })) {
    byUid.set(Number(msg.uid), msg);
  }
  return uids.map((uid) => byUid.get(Number(uid))).filter(Boolean);
}

/**
 * Search a folder and fetch the newest `limit` envelopes for the matched uids.
 * One SEARCH + one FETCH — not a fetch per message.
 */
export async function fetchEnvelopes(c, query, limit) {
  const uids = (await c.search(query, { uid: true })) || [];
  const pick = uids.slice(-limit).reverse();
  const msgs = await fetchByUids(c, pick, {
    uid: true,
    envelope: true,
    flags: true,
    bodyStructure: true,
  });
  return msgs.map(toEnvelope);
}

/**
 * Fetch thread nodes (envelope + optional server threadId + reference links) for
 * `uids` in one ranged FETCH.
 */
async function fetchThreadNodes(c, uids, withThreadId) {
  const msgs = await fetchByUids(c, uids, {
    uid: true,
    envelope: true,
    threadId: withThreadId,
    headers: ['references', 'in-reply-to'],
  });
  return msgs.map((msg) => {
    const env = msg.envelope || {};
    const raw = msg.headers ? msg.headers.toString() : '';
    const refs = [...parseMessageIds(headerValue(raw, 'references')), ...parseMessageIds(env.inReplyTo)];
    return {
      id: Number(msg.uid),
      messageId: env.messageId || null,
      threadId: msg.threadId || null,
      refs,
      date: env.date ? new Date(env.date).toISOString() : null,
      envelope: toEnvelope(msg),
    };
  });
}

/** Read one header value from a raw header block, joining folded continuation lines. */
function headerValue(raw, name) {
  const lower = name.toLowerCase();
  let value = null;
  for (const line of String(raw).split(/\r?\n/)) {
    if (value !== null) {
      if (/^\s/.test(line)) {
        value += ` ${line.trim()}`;
        continue;
      }
      break;
    }
    const idx = line.indexOf(':');
    if (idx > 0 && line.slice(0, idx).trim().toLowerCase() === lower) value = line.slice(idx + 1).trim();
  }
  return value;
}

/** Group nodes by the server's thread id (fallback to message-id / uid). */
function groupByThreadId(nodes) {
  const groups = new Map();
  for (const n of nodes) {
    const key = n.threadId || n.messageId || `uid:${n.id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(n);
  }
  return [...groups.values()];
}

/** Stable display key for a sorted thread. */
function threadKey(sorted, strategy) {
  if (strategy === 'thread-id') {
    const withId = sorted.find((n) => n.threadId);
    if (withId) return String(withId.threadId);
  }
  const root = sorted[0];
  return root.messageId || `uid:${root.id}`;
}

function byDateAscNode(a, b) {
  return new Date(a.date || 0).getTime() - new Date(b.date || 0).getTime();
}

/**
 * The open mailbox's HIGHESTMODSEQ as a string, or null when the server doesn't
 * track one. Stringified because modseq is unsigned 64-bit: it exceeds
 * Number.MAX_SAFE_INTEGER and SQLite INTEGER is *signed* 64-bit, so TEXT is the
 * only lossless carrier.
 */
function highestModseqOf(client) {
  const mailbox = client.mailbox;
  const v = mailbox && typeof mailbox === 'object' ? mailbox.highestModseq : undefined;
  return v == null ? null : String(v);
}

function uidValidityOf(client) {
  const mailbox = client.mailbox;
  const v = mailbox && typeof mailbox === 'object' ? mailbox.uidValidity : undefined;
  return v != null ? Number(v) : null;
}

function addr(list) {
  const a = list && list[0];
  return a ? { name: a.name || null, addr: a.address || null } : null;
}

function toEnvelope(msg) {
  const env = msg.envelope || {};
  return {
    id: Number(msg.uid),
    messageId: env.messageId || null,
    from: addr(env.from),
    to: addr(env.to),
    subject: env.subject || '',
    date: env.date ? new Date(env.date).toISOString() : null,
    flags: msg.flags ? [...msg.flags] : [],
    hasAttachment: hasAttachment(msg.bodyStructure),
  };
}

function hasAttachment(node) {
  if (!node) return false;
  if (node.disposition && String(node.disposition).toLowerCase() === 'attachment') return true;
  return Array.isArray(node.childNodes) && node.childNodes.some(hasAttachment);
}

function toMessage(id, p) {
  const one = (v) => (v ? { name: v.name || null, addr: v.address || null } : null);
  return {
    id: Number(id),
    messageId: p.messageId || null,
    from: one(p.from?.value?.[0]),
    to: (p.to?.value || []).map(one),
    subject: p.subject || '',
    date: p.date ? p.date.toISOString() : null,
    text: p.text || '',
    html: p.html || null,
    attachments: (p.attachments || []).map((a) => ({
      filename: a.filename || null,
      contentType: a.contentType || null,
      size: a.size ?? null,
    })),
  };
}
