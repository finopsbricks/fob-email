// @ts-check
/**
 * The `folders` resource — every folder object-operation, defined once.
 *
 * `buildFolders(ctx)` binds the transport seam into a flat namespace; this is
 * what `fobEmail(account).folders` is. Full CRUD (D1): an FDE filing receipts
 * wants `folders create Invoices/2026`, not just a read-only list.
 */

/**
 * @typedef {import('../types/general/index.js').Transport} Transport
 * @typedef {import('../types/domain/Folder.types.js').Folder} Folder
 */

/**
 * The folders client surface (declared so `checkJs` gives callers real checking).
 * @typedef {Object} FoldersApi
 * @property {() => Promise<Folder[]>} list
 * @property {(name: string) => Promise<any>} create
 * @property {(name: string, to: string) => Promise<any>} rename
 * @property {(name: string) => Promise<any>} delete
 */

/**
 * @param {Transport} ctx
 * @returns {FoldersApi}
 */
export function buildFolders(ctx) {
  return {
    /** All folders with basic metadata. */
    list: () => ctx.listFolders(),

    /** Create a folder (hierarchical path allowed, e.g. "Invoices/2026"). */
    create: (name) => ctx.createFolder(name),

    /** Rename/move a folder. */
    rename: (name, to) => ctx.renameFolder(name, to),

    /** Delete a folder. */
    delete: (name) => ctx.deleteFolder(name),
  };
}
