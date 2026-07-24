/**
 * Pure, client-side envelope filter. No connection — trivially testable and
 * composable with listEmails() output. Covers what IMAP server search can't
 * (notably `hasAttachment`).
 *
 * @param {object[]} envelopes  output of listEmails()
 * @param {object} criteria     { from, to, subject, hasAttachment, seen }
 */
export function filterEmails(envelopes = [], criteria = {}) {
  const { from, to, subject, hasAttachment, seen } = criteria;
  const inc = (hay, needle) => (hay || '').toLowerCase().includes(String(needle).toLowerCase());
  const addrMatch = (a, needle) => !!a && (inc(a.addr, needle) || inc(a.name, needle));

  return envelopes.filter((e) => {
    if (from != null && !addrMatch(e.from, from)) return false;
    if (to != null) {
      const list = Array.isArray(e.to) ? e.to : [e.to];
      if (!list.some((t) => addrMatch(t, to))) return false;
    }
    if (subject != null && !inc(e.subject, subject)) return false;
    if (hasAttachment != null && Boolean(e.hasAttachment) !== Boolean(hasAttachment)) return false;
    if (seen != null && (e.flags || []).includes('\\Seen') !== Boolean(seen)) return false;
    return true;
  });
}
