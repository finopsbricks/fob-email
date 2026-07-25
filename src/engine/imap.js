import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { resolveAccount } from '../config.js';

/**
 * A live IMAP session — the only place that talks IMAP.
 *
 * Hold one open for connection reuse (list → show → move → close), or use the
 * one-shot helpers in ../index.js. The transport seam (engine/transport.js)
 * wraps a lazily-connected Session so resources never touch the protocol.
 *
 * Message ids are per-folder IMAP UIDs. UIDs are scoped to a folder and
 * invalidated when the folder's UIDVALIDITY changes, so every id-targeting op
 * takes a `folder` and (optionally) the `uidValidity` the id was issued under;
 * see #openFolder, which throws a clear "stale id" error on mismatch rather than
 * acting on the wrong message (WIP decision D4).
 */
export class Session {
  #client;
  #address;

  /**
   * @param {import('imapflow').ImapFlow} client
   * @param {string|null} [address]
   */
  constructor(client, address) {
    this.#client = client;
    this.#address = address ?? null;
  }

  /** @param {string|object} [account] */
  static async connect(account) {
    const cfg = resolveAccount(account);
    const client = new ImapFlow({
      host: cfg.imap.host,
      port: cfg.imap.port,
      secure: cfg.imap.tls,
      auth: { user: cfg.imap.user, pass: cfg.imap.pass },
      logger: false,
    });
    await client.connect();
    return new Session(client, cfg.imap.user);
  }

  /**
   * The authenticated mailbox — the login user, confirmed by a successful
   * connect(). IMAP has no "whoami"; the login username is the mailbox address
   * for the providers we target, and reaching an open Session means auth passed.
   */
  identity() {
    return { address: this.#address };
  }

  /**
   * Open `folder` under a lock and run `fn(client)`. If `uidValidity` is given,
   * assert it matches the folder's current value first — a mismatch means the
   * caller's ids were issued against a since-reset folder and no longer point at
   * the messages they think (WIP decision D4).
   * @template T
   * @param {string} folder
   * @param {number|null|undefined} uidValidity
   * @param {(client: import('imapflow').ImapFlow) => Promise<T>} fn
   * @returns {Promise<T>}
   */
  async #openFolder(folder, uidValidity, fn) {
    const lock = await this.#client.getMailboxLock(folder);
    try {
      if (uidValidity != null) {
        const mailbox = this.#client.mailbox;
        const current = mailbox && typeof mailbox === 'object' ? mailbox.uidValidity : undefined;
        if (current != null && BigInt(current) !== BigInt(uidValidity)) {
          throw new Error(
            `Message id is stale (folder "${folder}" was reset) — re-list the folder to get fresh ids.`,
          );
        }
      }
      return await fn(this.#client);
    } finally {
      lock.release();
    }
  }

  /**
   * List envelopes (newest first). Returns the folder's current `uidValidity`
   * alongside the rows so callers can round-trip it into later write ops.
   * @param {{ folder?: string, unseenOnly?: boolean, limit?: number, criteria?: object }} [opts]
   */
  async list({ folder = 'INBOX', unseenOnly = false, limit = 50, criteria } = {}) {
    return this.#openFolder(folder, null, async (client) => {
      const query = criteria ?? (unseenOnly ? { seen: false } : { all: true });
      const uids = (await client.search(query, { uid: true })) || [];
      const pick = uids.slice(-limit).reverse();
      const out = [];
      for (const uid of pick) {
        const msg = await client.fetchOne(
          uid,
          { uid: true, envelope: true, flags: true, bodyStructure: true },
          { uid: true },
        );
        if (msg) out.push(toEnvelope(msg));
      }
      const uidValidity = uidValidityOf(client);
      return { data: out, uidValidity, folder };
    });
  }

  /**
   * Search a folder with an IMAP SEARCH criteria object (keyword/header/date —
   * no semantic search). Returns envelopes newest-first, same shape as list().
   * @param {{ folder?: string, criteria?: object, limit?: number }} [opts]
   */
  async search({ folder = 'INBOX', criteria = { all: true }, limit = 50 } = {}) {
    return this.list({ folder, criteria, limit });
  }

  /**
   * Fetch one full message by uid (parsed body + attachment metadata).
   * @param {{ id: number, folder?: string, uidValidity?: number|null }} opts
   */
  async fetchFull({ id, folder = 'INBOX', uidValidity } = /** @type {any} */ ({})) {
    return this.#openFolder(folder, uidValidity, async (client) => {
      const msg = await client.fetchOne(id, { uid: true, source: true }, { uid: true });
      if (!msg) throw new Error(`Message not found: ${id}`);
      return toMessage(id, await simpleParser(msg.source));
    });
  }

  /**
   * Fetch a message's attachments with their content buffers (for download).
   * @param {{ id: number, folder?: string, uidValidity?: number|null }} opts
   * @returns {Promise<Array<{ filename: string|null, contentType: string|null, size: number|null, content: Buffer }>>}
   */
  async fetchAttachments({ id, folder = 'INBOX', uidValidity } = /** @type {any} */ ({})) {
    return this.#openFolder(folder, uidValidity, async (client) => {
      const msg = await client.fetchOne(id, { uid: true, source: true }, { uid: true });
      if (!msg) throw new Error(`Message not found: ${id}`);
      const parsed = await simpleParser(msg.source);
      return (parsed.attachments || []).map((a) => ({
        filename: a.filename || null,
        contentType: a.contentType || null,
        size: a.size ?? null,
        content: a.content,
      }));
    });
  }

  /**
   * Set or clear a flag (e.g. '\\Seen') on a message.
   * @param {{ id: number, flag: string, on: boolean, folder?: string, uidValidity?: number|null }} opts
   */
  async setFlag({ id, flag, on, folder = 'INBOX', uidValidity } = /** @type {any} */ ({})) {
    return this.#openFolder(folder, uidValidity, async (client) => {
      const fn = on ? client.messageFlagsAdd : client.messageFlagsRemove;
      const ok = await fn.call(client, id, [flag], { uid: true });
      if (!ok) throw new Error(`Message not found: ${id}`);
      return { id, flag, on };
    });
  }

  /**
   * Move a message to another folder.
   * @param {{ id: number, to: string, folder?: string, uidValidity?: number|null }} opts
   */
  async move({ id, to, folder = 'INBOX', uidValidity } = /** @type {any} */ ({})) {
    return this.#openFolder(folder, uidValidity, async (client) => {
      await client.messageMove(id, to, { uid: true });
      return { id, from: folder, to };
    });
  }

  /**
   * Permanently delete a message (flag \\Deleted + expunge).
   * @param {{ id: number, folder?: string, uidValidity?: number|null }} opts
   */
  async expunge({ id, folder = 'INBOX', uidValidity } = /** @type {any} */ ({})) {
    return this.#openFolder(folder, uidValidity, async (client) => {
      const ok = await client.messageDelete(id, { uid: true });
      if (!ok) throw new Error(`Message not found: ${id}`);
      return { id, deleted: true };
    });
  }

  /** List folders with basic metadata. @returns {Promise<Array<{ path: string, name: string, specialUse: string|null, subscribed: boolean }>>} */
  async listFolders() {
    const boxes = await this.#client.list();
    return boxes.map((b) => ({
      path: b.path,
      name: b.name,
      specialUse: b.specialUse || null,
      subscribed: b.subscribed ?? false,
    }));
  }

  /** Create a folder. @param {string} name */
  async createFolder(name) {
    await this.#client.mailboxCreate(name);
    return { path: name, created: true };
  }

  /** Rename/move a folder. @param {string} name @param {string} to */
  async renameFolder(name, to) {
    await this.#client.mailboxRename(name, to);
    return { from: name, to };
  }

  /** Delete a folder. @param {string} name */
  async deleteFolder(name) {
    await this.#client.mailboxDelete(name);
    return { path: name, deleted: true };
  }

  async close() {
    try {
      await this.#client.logout();
    } catch {
      /* already gone */
    }
  }
}

/** @param {import('imapflow').ImapFlow} client */
function uidValidityOf(client) {
  const mailbox = client.mailbox;
  const v = mailbox && typeof mailbox === 'object' ? mailbox.uidValidity : undefined;
  return v != null ? Number(v) : null;
}

/** @param {any} list */
function addr(list) {
  const a = list && list[0];
  return a ? { name: a.name || null, addr: a.address || null } : null;
}

/** @param {any} msg */
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

/** @param {any} node @returns {boolean} */
function hasAttachment(node) {
  if (!node) return false;
  if (node.disposition && String(node.disposition).toLowerCase() === 'attachment') return true;
  return Array.isArray(node.childNodes) && node.childNodes.some(hasAttachment);
}

/** @param {number} id @param {any} p */
function toMessage(id, p) {
  /** @param {any} v */
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
    attachments: (p.attachments || []).map((/** @type {any} */ a) => ({
      filename: a.filename || null,
      contentType: a.contentType || null,
      size: a.size ?? null,
    })),
  };
}
