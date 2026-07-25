import { readFileSync, writeFileSync, mkdirSync, chmodSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { z } from 'zod';

/**
 * Account resolution + credential store for the fob-email CLI.
 *
 * Config lives under the shared fob family root, so every fob-<tool> wrapper
 * keeps its creds in one place (one backup / chmod / delete surface):
 *
 *   ~/.fob/fob-email/config.yml    mode 0600, subdir = the binary name
 *
 * Path is home-dir based (os.homedir) for multi-OS support — not XDG. Override
 * the whole dir with FOB_EMAIL_CONFIG_DIR (tests, containers, CI).
 *
 * Secret/metadata seam: this module is the sole reader/writer of the connection
 * password. resolveAccount() reconstitutes the full { imap, smtp } object the
 * client needs; listAccounts() returns metadata only (never the password). That
 * seam — per CLI standard decision A — is where a future keychain layer plugs in.
 *
 * Precedence (standard: flag > env > config):
 *   - named account (the `account` arg / --account flag):  FOB_EMAIL_ACCOUNTS env  →  config file
 *   - no name:  first FOB_EMAIL_ACCOUNTS entry  →  config `current`  →  first file account
 *
 * FOB_EMAIL_ACCOUNTS is a JSON map `{ name: { imap, smtp } }` — the worker env
 * contract for both single- and multi-account setups. (The old single-account
 * IMAP_ and SMTP_ convenience vars were retired in favor of this one path.)
 */

const CONFIG_DIR = process.env.FOB_EMAIL_CONFIG_DIR || join(homedir(), '.fob', 'fob-email');
export const CONFIG_PATH = join(CONFIG_DIR, 'config.yml');

const ImapSchema = z.object({
  host: z.string(),
  port: z.number().default(993),
  user: z.string(),
  pass: z.string(),
  tls: z.boolean().default(true),
});

const SmtpSchema = z
  .object({
    host: z.string().optional(),
    port: z.number().default(465),
    user: z.string().optional(),
    pass: z.string().optional(),
    secure: z.boolean().default(true),
  })
  .optional();

const AccountSchema = z.object({ imap: ImapSchema, smtp: SmtpSchema });

// -- storage layer -----------------------------------------------------------

/** Read the config file, or an empty store if none exists. */
export function loadConfig() {
  if (!existsSync(CONFIG_PATH)) return { current: null, accounts: {} };
  const cfg = yaml.load(readFileSync(CONFIG_PATH, 'utf8')) || {};
  return { current: cfg.current ?? null, accounts: cfg.accounts ?? {} };
}

/** Write the config file, enforcing mode 0600 on every write (create or update). */
export function saveConfig(cfg) {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, yaml.dump(cfg), { mode: 0o600 });
  chmodSync(CONFIG_PATH, 0o600); // mode above only applies on create; force it on rewrite too
  return cfg;
}

/** Add or replace an account. First account added becomes `current`. */
export function addAccount(name, { imap, smtp } = {}) {
  const cfg = loadConfig();
  cfg.accounts[name] = smtp ? { imap, smtp } : { imap };
  if (!cfg.current) cfg.current = name;
  return saveConfig(cfg);
}

/** Remove an account; reassign `current` to another if it was the current one. */
export function removeAccount(name) {
  const cfg = loadConfig();
  if (!cfg.accounts[name]) throw new Error(`No account named '${name}'.`);
  delete cfg.accounts[name];
  if (cfg.current === name) cfg.current = Object.keys(cfg.accounts)[0] ?? null;
  return saveConfig(cfg);
}

/** Switch the current account. */
export function useAccount(name) {
  const cfg = loadConfig();
  if (!cfg.accounts[name]) {
    throw new Error(`No account named '${name}'. Run \`fob-email config accounts add ${name}\`.`);
  }
  cfg.current = name;
  return saveConfig(cfg);
}

/**
 * Accounts for display — metadata only, secrets omitted (the secret/metadata
 * seam). `address` is the cached authenticated mailbox (filled in Phase 4).
 */
export function listAccounts() {
  const cfg = loadConfig();
  const accounts = Object.entries(cfg.accounts).map(([name, a]) => ({
    name,
    current: name === cfg.current,
    address: a.address ?? null,
    imap: a.imap ? { host: a.imap.host, port: a.imap.port, user: a.imap.user, tls: a.imap.tls } : null,
    smtp: a.smtp ? { host: a.smtp.host, port: a.smtp.port, user: a.smtp.user, secure: a.smtp.secure } : null,
  }));
  return { current: cfg.current, path: CONFIG_PATH, accounts };
}

/**
 * Merge the server-resolved mailbox `address` into a stored account as
 * non-secret metadata (decision G). Leaves credentials untouched.
 */
export function setAccountIdentity(accountName, { address } = {}) {
  const cfg = loadConfig();
  if (!cfg.accounts[accountName]) throw new Error(`No account named '${accountName}'.`);
  cfg.accounts[accountName] = { ...cfg.accounts[accountName], address: address ?? null };
  return saveConfig(cfg);
}

/** Every configured account name (for `refresh --all`). */
export function accountNames() {
  return Object.keys(loadConfig().accounts);
}

/** Absolute path to the config file (shown in the `accounts list` footer). */
export function configPath() {
  return CONFIG_PATH;
}

// -- resolution --------------------------------------------------------------

/** @param {string|object} [account] account name, or a raw config object. */
export function resolveAccount(account) {
  if (account && typeof account === 'object') return AccountSchema.parse(account);

  const name = account;
  const envMap = parseJson(process.env.FOB_EMAIL_ACCOUNTS);
  const cfg = loadConfig();

  let raw;
  if (name) {
    raw = envMap?.[name] ?? cfg.accounts?.[name];
    if (!raw) {
      throw new Error(`Unknown account "${name}" (checked FOB_EMAIL_ACCOUNTS env and ${CONFIG_PATH})`);
    }
  } else {
    raw =
      (envMap ? Object.values(envMap)[0] : null) ??
      (cfg.current ? cfg.accounts?.[cfg.current] : null) ??
      Object.values(cfg.accounts ?? {})[0];
    if (!raw) {
      throw new Error(
        `No email account configured. Set FOB_EMAIL_ACCOUNTS env, or run \`fob-email config accounts add <name>\` (${CONFIG_PATH}).`,
      );
    }
  }
  return AccountSchema.parse(raw);
}

function parseJson(s) {
  return s ? JSON.parse(s) : null;
}
