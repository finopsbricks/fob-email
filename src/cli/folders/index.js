// @ts-check
import { safe, localOptions } from '../_helpers.js';
import { listFoldersHandler } from './list.js';
import { createFolderHandler } from './create.js';
import { renameFolderHandler } from './rename.js';
import { deleteFolderHandler } from './delete.js';

/**
 * `fob-email folders <action>` — the folders resource command tree (D1: full CRUD).
 */
export function buildFoldersSubcommands(yargs) {
  return yargs
    .usage('$0 folders <action> [options]')
    .command(
      'list',
      'List folders',
      (y) =>
        localOptions(y)
          .option('account', { describe: 'Configured account name', type: 'string' })
          .option('json', { describe: 'Output raw JSON', type: 'boolean' }),
      safe(listFoldersHandler),
    )
    .command(
      'create <name>',
      'Create a folder (e.g. Invoices/2026)',
      (y) =>
        localOptions(y.positional('name', { describe: 'Folder path', type: 'string' }))
          .option('account', { describe: 'Configured account name', type: 'string' })
          .option('json', { describe: 'Output raw JSON', type: 'boolean' }),
      safe(createFolderHandler),
    )
    .command(
      'rename <name>',
      'Rename or move a folder',
      (y) =>
        localOptions(y.positional('name', { describe: 'Existing folder path', type: 'string' }))
          .option('to', { describe: 'New folder path', type: 'string', demandOption: true })
          .option('account', { describe: 'Configured account name', type: 'string' })
          .option('json', { describe: 'Output raw JSON', type: 'boolean' }),
      safe(renameFolderHandler),
    )
    .command(
      'delete <name>',
      'Delete a folder',
      (y) =>
        localOptions(y.positional('name', { describe: 'Folder path', type: 'string' }))
          .option('yes', { alias: 'y', describe: 'Confirm deletion', type: 'boolean' })
          .option('account', { describe: 'Configured account name', type: 'string' })
          .option('json', { describe: 'Output raw JSON', type: 'boolean' }),
      safe(deleteFolderHandler),
    )
    .demandCommand(1, 'Specify an action: list, create, rename, delete');
}
