import { listAccounts } from '../../config.js';
import { emitJson } from '../_helpers.js';
import { formatTable } from '../../utils/format.js';

/** `fob-email config accounts list` — table of accounts, secrets omitted. */
export function listConfigHandler(argv) {
  const { current, path, accounts } = listAccounts();

  if (argv.json) {
    emitJson({ current, accounts });
    return;
  }

  if (accounts.length === 0) {
    console.log('(no accounts configured — run `fob-email config accounts add <name>`)');
    console.log(`\nconfig: ${path}`);
    return;
  }

  // The address/provider columns appear only once any account has been probed
  // (decision G + D6): connecting to fill them must never be required to list.
  const hasProfile = accounts.some((a) => a.address || a.provider);

  const headers = hasProfile
    ? ['', 'NAME', 'ADDRESS', 'PROVIDER', 'IMAP', 'SMTP']
    : ['', 'NAME', 'IMAP', 'SMTP'];

  const rows = accounts.map((a) => {
    const mark = a.current ? '*' : ' ';
    const imap = a.imap ? `${a.imap.host}:${a.imap.port}` : '';
    const smtp = a.smtp ? `${a.smtp.host}:${a.smtp.port}` : '';
    const provider = a.provider ? `${a.provider}/${a.threadStrategy ?? '?'}` : '';
    return hasProfile ? [mark, a.name, a.address ?? '', provider, imap, smtp] : [mark, a.name, imap, smtp];
  });

  console.log(formatTable(headers, rows));
  console.log(`\n(* = current)  config: ${path}`);
}
