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

  // The address column appears only once any account has a cached identity (decision G, Phase 4).
  const hasAddress = accounts.some((a) => a.address);

  const headers = hasAddress
    ? ['', 'NAME', 'ADDRESS', 'IMAP', 'SMTP']
    : ['', 'NAME', 'IMAP', 'SMTP'];

  const rows = accounts.map((a) => {
    const mark = a.current ? '*' : ' ';
    const imap = a.imap ? `${a.imap.host}:${a.imap.port}` : '';
    const smtp = a.smtp ? `${a.smtp.host}:${a.smtp.port}` : '';
    return hasAddress ? [mark, a.name, a.address ?? '', imap, smtp] : [mark, a.name, imap, smtp];
  });

  console.log(formatTable(headers, rows));
  console.log(`\n(* = current)  config: ${path}`);
}
