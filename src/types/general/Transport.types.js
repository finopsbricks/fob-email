// @ts-check
/**
 * The protocol transport seam — the object `createTransport(account)` returns
 * (engine/transport.js). Resources bind to this and nothing lower; it is the
 * `Transport` analog of an HTTP client's request surface.
 *
 * @typedef {Object} Transport
 * @property {(opts?: object) => Promise<{ data: any[], uidValidity: number|null, folder: string }>} list
 * @property {(opts?: object) => Promise<{ data: any[], uidValidity: number|null, folder: string }>} search
 * @property {(opts: object) => Promise<any>} fetchFull
 * @property {(opts: object) => Promise<Array<object>>} fetchAttachments
 * @property {() => Promise<Array<object>>} listFolders
 * @property {(folder?: string) => Promise<{ folder: string, uidNext: number|null, uidValidity: number|null, messages: number|null, highestModseq: string|null }>} statusOf
 * @property {(opts?: object) => Promise<{ folder: string, uidValidity: number|null, highestModseq: string|null, uids: number[], windowFrom: number|null, data: any[] }>} fetchForSync
 * @property {() => Promise<boolean>} hasCondstore
 * @property {(opts?: object) => Promise<{ supported: boolean, folder: string, uidValidity?: number|null, changes: Array<{ id: number, flags: string[] }> }>} fetchFlagChanges
 * @property {(opts?: object) => Promise<{ folder: string, uidValidity: number|null, uids: number[] }>} listUids
 * @property {(opts?: object) => Promise<Array<object>>} listThreads
 * @property {(opts: object) => Promise<{ id: string, messages: any[] }>} resolveThread
 * @property {(opts: object) => Promise<any>} setFlag
 * @property {(opts: object) => Promise<any>} move
 * @property {(opts: object) => Promise<any>} expunge
 * @property {(name: string) => Promise<any>} createFolder
 * @property {(name: string, to: string) => Promise<any>} renameFolder
 * @property {(name: string) => Promise<any>} deleteFolder
 * @property {(message: object) => Promise<any>} send
 * @property {() => Promise<{ data: any[], folder: string }>} listDrafts
 * @property {(message: object) => Promise<any>} createDraft
 * @property {(id: number, message: object) => Promise<any>} editDraft
 * @property {(id: number) => Promise<any>} deleteDraft
 * @property {(id: number) => Promise<any>} sendDraft
 * @property {() => Promise<void>} close
 */

export {};
