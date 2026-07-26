// @ts-check
import { safe } from '../_helpers.js';
import { composeOptions } from '../emails/_message.js';
import { listDraftsHandler } from './list.js';
import { createDraftHandler } from './create.js';
import { editDraftHandler } from './edit.js';
import { deleteDraftHandler } from './delete.js';
import { sendDraftHandler } from './send.js';

const idOnly = (y) =>
  y
    .positional('id', { describe: 'Draft id (per-folder UID)', type: 'number' })
    .option('account', { describe: 'Configured account name', type: 'string' })
    .option('json', { describe: 'Output raw JSON', type: 'boolean' });

/**
 * `fob-email drafts <action>` — the compose lifecycle. `create`/`edit` reuse the
 * shared D3 compose flags; `edit` replaces the draft wholesale (append-new +
 * delete-old, since IMAP messages are immutable).
 */
export function buildDraftsSubcommands(yargs) {
  return yargs
    .usage('$0 drafts <action> [options]')
    .command(
      'list',
      'List saved drafts',
      (y) =>
        y
          .option('account', { describe: 'Configured account name', type: 'string' })
          .option('json', { describe: 'Output raw JSON', type: 'boolean' }),
      safe(listDraftsHandler),
    )
    .command('create', 'Save a new draft', (y) => composeOptions(y), safe(createDraftHandler))
    .command('edit <id>', 'Replace a draft (append-new + delete-old)', (y) => composeOptions(idOnly(y)), safe(editDraftHandler))
    .command(
      'delete <id>',
      'Delete a draft',
      (y) => idOnly(y).option('yes', { alias: 'y', describe: 'Confirm deletion', type: 'boolean' }),
      safe(deleteDraftHandler),
    )
    .command('send <id>', 'Send a saved draft (SMTP)', idOnly, safe(sendDraftHandler))
    .demandCommand(1, 'Specify an action: list, create, edit, delete, send');
}
