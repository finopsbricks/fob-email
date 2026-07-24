import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { z } from 'zod';

/**
 * Account resolution, env-first (fob worker convention) with a YAML file
 * fallback that lives in the fobs CLI secret home (~/.fobs).
 *
 * Precedence for a named account:  FOB_EMAIL_ACCOUNTS env  →  config file
 * Precedence for the default (no name):  IMAP_* env  →  file default  →  first env account
 *
 * Sources
 *   - IMAP_* / SMTP_* env         a single default account (workers: loaded via dotenv)
 *   - FOB_EMAIL_ACCOUNTS env      JSON map { name: { imap, smtp } } (multi-account workers)
 *   - config file (YAML)          { default, accounts: { name: { imap, smtp } } }
 *                                 at $FOB_EMAIL_CONFIG, else $FOBS_CONFIG_DIR/email.yml,
 *                                 else ~/.fobs/email.yml
 */

const FOBS_DIR = process.env.FOBS_CONFIG_DIR || join(homedir(), '.fobs');
export const CONFIG_PATH = process.env.FOB_EMAIL_CONFIG || join(FOBS_DIR, 'email.yml');

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

/** @param {string|object} [account] account name, or a raw config object. */
export function resolveAccount(account) {
  if (account && typeof account === 'object') return AccountSchema.parse(account);

  const name = account;
  const envMap = parseJson(process.env.FOB_EMAIL_ACCOUNTS);
  const file = readConfigFile();
  const single = process.env.IMAP_HOST ? singleFromEnv() : null;

  let raw;
  if (name) {
    raw = envMap?.[name] ?? file?.accounts?.[name];
    if (!raw) {
      throw new Error(`Unknown account "${name}" (checked FOB_EMAIL_ACCOUNTS env and ${CONFIG_PATH})`);
    }
  } else {
    raw =
      single ??
      (file ? (file.accounts?.[file.default] ?? Object.values(file.accounts ?? {})[0]) : null) ??
      (envMap ? Object.values(envMap)[0] : null);
    if (!raw) {
      throw new Error(`No email account configured. Set IMAP_* / FOB_EMAIL_ACCOUNTS env, or create ${CONFIG_PATH}`);
    }
  }
  return AccountSchema.parse(raw);
}

function readConfigFile() {
  if (!existsSync(CONFIG_PATH)) return null;
  return yaml.load(readFileSync(CONFIG_PATH, 'utf8'));
}

function parseJson(s) {
  return s ? JSON.parse(s) : null;
}

function singleFromEnv() {
  const bool = (v, d) => (v == null ? d : v !== 'false');
  return {
    imap: {
      host: process.env.IMAP_HOST,
      port: Number(process.env.IMAP_PORT ?? 993),
      user: process.env.IMAP_USER,
      pass: process.env.IMAP_PASSWORD ?? process.env.IMAP_PASS,
      tls: bool(process.env.IMAP_TLS, true),
    },
    smtp: {
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? 465),
      user: process.env.SMTP_USER ?? process.env.IMAP_USER,
      pass: process.env.SMTP_PASS ?? process.env.SMTP_PASSWORD,
      secure: bool(process.env.SMTP_SECURE, true),
    },
  };
}
