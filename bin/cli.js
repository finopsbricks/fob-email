#!/usr/bin/env node
import { listEmails, readEmail, filterEmails } from '../src/index.js';

const argv = process.argv.slice(2);
const cmd = argv[0];
const { flags, positionals } = parse(argv.slice(1));

try {
  switch (cmd) {
    case 'list':
      emit(
        await listEmails({
          account: flags.account,
          folder: flags.folder,
          unseenOnly: has(flags, 'unseen'),
          limit: flags.limit ? Number(flags.limit) : undefined,
        }),
      );
      break;

    case 'read': {
      const id = positionals[0];
      if (!id) fail('usage: fob-email read <id> [--account N] [--folder F]');
      emit(await readEmail({ account: flags.account, id: Number(id), folder: flags.folder }));
      break;
    }

    case 'filter':
      emit(
        filterEmails(JSON.parse(await readStdin()), {
          from: flags.from,
          to: flags.to,
          subject: flags.subject,
          hasAttachment: has(flags, 'has-attachment') ? true : undefined,
          seen: has(flags, 'seen') ? true : has(flags, 'unseen') ? false : undefined,
        }),
      );
      break;

    case undefined:
    case '-h':
    case '--help':
      usage();
      break;

    default:
      fail(`unknown command: ${cmd}`);
  }
} catch (err) {
  console.error(err?.message || err);
  process.exit(1);
}

function parse(args) {
  const flags = {};
  const positionals = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = args[i + 1];
      if (next != null && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positionals.push(a);
    }
  }
  return { flags, positionals };
}

function has(flags, k) {
  return flags[k] === true || flags[k] === 'true';
}
function emit(o) {
  process.stdout.write(`${JSON.stringify(o, null, 2)}\n`);
}
function fail(m) {
  console.error(m);
  process.exit(2);
}

function usage() {
  process.stdout.write(`fob-email — generic email CLI

Commands:
  list [--account N] [--folder INBOX] [--unseen] [--limit 50]
  read <id> [--account N] [--folder INBOX]
  filter [--from S] [--to S] [--subject S] [--has-attachment] [--seen|--unseen]
         (reads an envelopes JSON array from stdin)

Output: JSON on stdout, logs on stderr. Config via FOB_EMAIL_ACCOUNTS or IMAP_* env.

Example:
  fob-email list --account gmail --unseen | fob-email filter --from tally --has-attachment
`);
}

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}
