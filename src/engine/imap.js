import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { resolveAccount } from '../config.js';

/**
 * A live IMAP session — the only place that talks IMAP.
 * Hold one open for connection reuse (list → read → move → close),
 * or use the one-shot helpers in ../index.js.
 */
export class Session {
  #client;
  #address;

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

  /** List envelopes (newest first). */
  async list({ folder = 'INBOX', unseenOnly = false, limit = 50 } = {}) {
    const lock = await this.#client.getMailboxLock(folder);
    try {
      const uids =
        (await this.#client.search(unseenOnly ? { seen: false } : { all: true }, { uid: true })) || [];
      const pick = uids.slice(-limit).reverse();
      const out = [];
      for (const uid of pick) {
        const msg = await this.#client.fetchOne(
          uid,
          { uid: true, envelope: true, flags: true, bodyStructure: true },
          { uid: true },
        );
        if (msg) out.push(toEnvelope(msg));
      }
      return out;
    } finally {
      lock.release();
    }
  }

  /** Read one full message by uid. */
  async read({ id, folder = 'INBOX' }) {
    const lock = await this.#client.getMailboxLock(folder);
    try {
      const msg = await this.#client.fetchOne(id, { uid: true, source: true }, { uid: true });
      if (!msg) throw new Error(`Message not found: ${id}`);
      return toMessage(id, await simpleParser(msg.source));
    } finally {
      lock.release();
    }
  }

  async close() {
    try {
      await this.#client.logout();
    } catch {
      /* already gone */
    }
  }
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
