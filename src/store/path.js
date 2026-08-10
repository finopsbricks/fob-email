import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Where the local mirror lives.
 *
 * Alongside config.yml under the shared fob family root, so the whole tool is
 * one backup / chmod / delete surface:
 *
 *   ~/.fob/fob-email/sync.db
 *
 * Resolved per call (not at module load, unlike config.js's CONFIG_PATH) so a
 * test can point FOB_EMAIL_CONFIG_DIR at a temp dir after import.
 */
export function storeDir() {
  return process.env.FOB_EMAIL_CONFIG_DIR || join(homedir(), '.fob', 'fob-email');
}

/** Absolute path to the mirror file. */
export function storePath() {
  return join(storeDir(), 'sync.db');
}
