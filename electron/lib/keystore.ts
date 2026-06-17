/**
 * Keystore (SET-01 core) — safeStorage-encrypted API key storage.
 *
 * Responsibilities:
 *  - Encrypt plaintext API keys with Electron's `safeStorage` (OS keychain on
 *    macOS, DPAPI on Windows, libsecret on Linux). The plaintext key NEVER
 *    touches disk, logs, or IPC return values (08-settings-data §7.1, §8.3).
 *  - Provide `getActiveApiKey()` for the AI module (Phase 5) to obtain the
 *    decrypted key + endpoint config in-process.
 *  - The provider list starts empty; the renderer's editor pre-fills the
 *    DeepSeek defaults when adding a new provider (no DB-level seeding).
 *
 * Security red lines (08-settings-data §8.3):
 *  - Plaintext key lives only in main-process memory, single-call lifetime.
 *  - All logging redacts the key value (logs show provider id / hasKey only).
 *  - AppError.details must never contain the plaintext key.
 *
 * Fallback (§7.1.4): if safeStorage.isEncryptionAvailable() is false (e.g.
 * headless Linux / dev without keychain), we fall back to machine-bound AES.
 * This is weaker than safeStorage but avoids plaintext-on-disk habits.
 */

import { safeStorage } from 'electron'
import { createHash, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { hostname, userInfo } from 'node:os'
import { getDb } from '../db/connection'
import { AppError } from './error'

// ---------- types ----------

export interface ActiveApiKeyResult {
  /** Provider id (e.g. 'deepseek-default'). */
  provider: string
  /** API base URL (e.g. 'https://api.deepseek.com/v1'). */
  baseUrl: string
  /** Default model name (e.g. 'deepseek-chat'). */
  model: string
  /** Plaintext API key — main-process only, never crosses IPC. */
  apiKey: string
}

export interface ProviderCredentialRow {
  id: string
  provider: string
  label: string
  base_url: string
  model: string
  api_key_enc: Buffer | null
  key_iv_hint: string | null
  is_active: number
  created_at: number
  updated_at: number
}

// ---------- safeStorage helpers ----------

/**
 * Encrypts a plaintext string via Electron safeStorage.
 * Returns the encrypted Buffer, or null if input is empty.
 */
export function encryptApiKey(plaintext: string): Buffer {
  if (!plaintext) throw new AppError('VALIDATION', 'apiKey must not be empty')
  if (safeStorage.isEncryptionAvailable()) {
    return safeStorage.encryptString(plaintext)
  }
  // Fallback: machine-bound AES-256-GCM (§7.1.4)
  return fallbackEncrypt(plaintext)
}

/**
 * Decrypts a safeStorage-encrypted Buffer back to plaintext.
 * Throws AI_AUTH on failure (corrupted key, different machine, etc.).
 */
export function decryptApiKey(encrypted: Buffer, hint?: string | null): string {
  if (!encrypted || encrypted.length === 0) {
    throw new AppError('VALIDATION', 'No API key stored for this provider')
  }

  if (hint === 'fallback-aes-machinebound') {
    return fallbackDecrypt(encrypted)
  }

  if (safeStorage.isEncryptionAvailable()) {
    try {
      return safeStorage.decryptString(encrypted)
    } catch {
      throw new AppError(
        'AI',
        'API Key 解密失败 — 可能是在不同机器上加密，或 OS 密钥已变更。请重新配置 API Key。',
      )
    }
  }

  // safeStorage unavailable now but key was encrypted with safeStorage earlier
  throw new AppError(
    'AI',
    '当前环境不支持系统级加密 (safeStorage 不可用)，无法解密此前存储的 API Key。请重新配置。',
  )
}

// ---------- machine-bound AES fallback (§7.1.4) ----------

const FALLBACK_SALT = 'zyx-set-v1-static-salt-do-not-rely-on-this-for-security'

function machineFingerprint(): string {
  // Best-effort machine identity — stable on same machine, differs across machines.
  const raw = [hostname(), userInfo().username, process.platform].join('|')
  return createHash('sha256').update(FALLBACK_SALT + raw, 'utf8').digest('hex')
}

/**
 * AES-256-GCM with a machine-derived key. Output format:
 * [12-byte IV][16-byte auth tag][ciphertext] packed into one Buffer.
 */
function fallbackEncrypt(plaintext: string): Buffer {
  const key = machineFingerprint() // 32 bytes
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, encrypted])
}

function fallbackDecrypt(data: Buffer): string {
  const key = machineFingerprint()
  const iv = data.subarray(0, 12)
  const tag = data.subarray(12, 28)
  const ciphertext = data.subarray(28)
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  try {
    return decipher.update(ciphertext, undefined, 'utf8') + decipher.final('utf8')
  } catch {
    throw new AppError(
      'AI',
      'API Key 解密失败（机器绑定加密）— 可能在不同机器上加密。请重新配置 API Key。',
    )
  }
}

// ---------- DB operations ----------

const FALLBACK_HINT = 'fallback-aes-machinebound'

function getHint(): string | null {
  return safeStorage.isEncryptionAvailable() ? null : FALLBACK_HINT
}

/**
 * Saves (or updates) a provider credential. If apiKey is provided and non-empty,
 * it is encrypted before storage. If apiKey is omitted/null, the existing key
 * is preserved unchanged.
 *
 * @param id provider id; if it doesn't exist a new row is created
 * @param apiKey plaintext key (will be encrypted); omit/null to keep existing
 */
export function saveProviderCredential(
  id: string,
  provider: string,
  label: string,
  baseUrl: string,
  model: string,
  apiKey?: string | null,
): void {
  if (!id) throw new AppError('VALIDATION', 'provider id is required')
  if (!provider) throw new AppError('VALIDATION', 'provider type is required')
  if (!baseUrl) throw new AppError('VALIDATION', 'baseUrl is required')
  if (!model) throw new AppError('VALIDATION', 'model is required')

  const db = getDb()
  const now = Date.now()
  const existing = db
    .prepare('SELECT api_key_enc, key_iv_hint FROM api_credentials WHERE id = ?')
    .get(id) as { api_key_enc: Buffer | null; key_iv_hint: string | null } | undefined

  let keyEnc: Buffer | null
  let keyHint: string | null

  if (apiKey != null && apiKey !== '') {
    keyEnc = encryptApiKey(apiKey)
    keyHint = getHint()
  } else {
    // preserve existing key
    keyEnc = existing?.api_key_enc ?? null
    keyHint = existing?.key_iv_hint ?? null
  }

  if (existing) {
    db.prepare(
      `UPDATE api_credentials
       SET provider = @provider, label = @label, base_url = @baseUrl,
           model = @model, api_key_enc = @keyEnc, key_iv_hint = @keyHint,
           updated_at = @now
       WHERE id = @id`,
    ).run({ id, provider, label, baseUrl, model, keyEnc, keyHint, now })
  } else {
    db.prepare(
      `INSERT INTO api_credentials
         (id, provider, label, base_url, model, api_key_enc, key_iv_hint,
          is_active, created_at, updated_at)
       VALUES (@id, @provider, @label, @baseUrl, @model, @keyEnc, @keyHint,
               0, @now, @now)`,
    ).run({ id, provider, label, baseUrl, model, keyEnc, keyHint, now })
  }
}

/**
 * Sets the active provider, ensuring exactly one row has is_active=1.
 * Also writes the settings.ai.currentProvider key for redundancy.
 */
export function setActiveProvider(id: string): void {
  const db = getDb()
  const exists = db
    .prepare('SELECT 1 FROM api_credentials WHERE id = ?')
    .get(id)
  if (!exists) throw new AppError('NOT_FOUND', `provider ${id} not found`)

  const now = Date.now()
  const tx = db.transaction(() => {
    db.prepare('UPDATE api_credentials SET is_active = 0').run()
    db.prepare('UPDATE api_credentials SET is_active = 1, updated_at = ? WHERE id = ?').run(now, id)
    db.prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES ('ai.currentProvider', ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    ).run(id, now)
  })
  tx()
}

/**
 * Returns the active provider's decrypted key + endpoint config.
 * This is the STABLE signature the AI module (Phase 5) depends on.
 *
 * @returns null if no active provider exists or no key is configured.
 *          The plaintext apiKey is only in main-process memory.
 */
export function getActiveApiKey(): ActiveApiKeyResult | null {
  const db = getDb()
  const row = db
    .prepare(
      `SELECT id, provider, base_url, model, api_key_enc, key_iv_hint
       FROM api_credentials
       WHERE is_active = 1`,
    )
    .get() as ProviderCredentialRow | undefined

  if (!row) return null
  if (!row.api_key_enc || row.api_key_enc.length === 0) return null

  const apiKey = decryptApiKey(row.api_key_enc, row.key_iv_hint)

  return {
    provider: row.id,
    baseUrl: row.base_url,
    model: row.model,
    apiKey,
  }
}

/**
 * Returns all provider rows (raw DB shape, including encrypted key BLOB).
 * For internal use only; the IPC layer maps these to safe DTOs.
 */
export function listProviderCredentials(): ProviderCredentialRow[] {
  const db = getDb()
  return db
    .prepare(
      `SELECT id, provider, label, base_url, model, api_key_enc, key_iv_hint,
              is_active, created_at, updated_at
       FROM api_credentials
       ORDER BY is_active DESC, created_at ASC`,
    )
    .all() as ProviderCredentialRow[]
}
