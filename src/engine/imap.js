import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { resolveAccount } from '../config.js';

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

  return {
    /**
     * The authenticated mailbox — the login user, confirmed by a successful
     * connect(). IMAP has no "whoami"; the login username is the mailbox address
     * for the providers we target, and reaching here means auth passed.
     */
    identity: () => ({ address }),

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

    /** List folders with basic metadata. */
    listFolders: async () => {
      const boxes = await client.list();
      return boxes.map((b) => ({
        path: b.path,
        name: b.name,
        specialUse: b.specialUse || null,
        subscribed: b.subscribed ?? false,
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

/** Search a folder and fetch the newest `limit` envelopes for the matched uids. */
async function fetchEnvelopes(c, query, limit) {
  const uids = (await c.search(query, { uid: true })) || [];
  const pick = uids.slice(-limit).reverse();
  const out = [];
  for (const uid of pick) {
    const msg = await c.fetchOne(
      uid,
      { uid: true, envelope: true, flags: true, bodyStructure: true },
      { uid: true },
    );
    if (msg) out.push(toEnvelope(msg));
  }
  return out;
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
