-- SET module DDL (08-settings-data.md §4). This file is the reviewable source of
-- truth; the *executable* copy is inlined as migration v6 'settings' in
-- electron/db/migrate.ts (the migration runner is an inline registry, not a
-- file loader — see S4.4 decision in docs/dev/PROGRESS.md).
--
-- Two new tables: settings (key/value preferences) and api_credentials
-- (safeStorage-encrypted API keys). Current UI uses fixed AI configuration
-- slots; plaintext secrets never cross IPC.
-- api_credentials holds the encrypted key BLOB only; the plaintext key never
-- touches disk, logs, or IPC return values (08-settings-data §7.1, §8.3).
--
-- Hard constraints honoured:
--  - No references to paragraphs/chapters/books stable IDs — these tables are
--    independent of content tables.
--  - No DROP / regenerate of any existing stable ID column (§5.5).
--  - Forward-only, idempotent DDL (CREATE IF NOT EXISTS).

-- ---------------------------------------------------------------------------
-- settings — key/value preferences store
-- ---------------------------------------------------------------------------
-- Holds future flat preferences. Values are JSON strings or scalars; serialized
-- by the app.
CREATE TABLE IF NOT EXISTS settings (
  key         TEXT PRIMARY KEY,          -- e.g. 'appearance.theme', 'disclaimer.accepted'
  value       TEXT NOT NULL,             -- JSON or scalar string
  updated_at  INTEGER NOT NULL           -- unix ms
);

-- ---------------------------------------------------------------------------
-- api_credentials (SET-01) — encrypted provider credentials
-- ---------------------------------------------------------------------------
-- Each row = one fixed provider configuration slot.
-- api_key_enc is the raw Buffer returned by Electron safeStorage.encryptString;
-- it is OS-keychain-bound (macOS Keychain / Windows DPAPI / Linux libsecret).
-- base_url and model are non-sensitive metadata stored in plaintext for UI.
CREATE TABLE IF NOT EXISTS api_credentials (
  id            TEXT PRIMARY KEY,            -- e.g. 'deepseek-default'
  provider      TEXT NOT NULL,               -- 'deepseek' | 'openai' | 'anthropic' | 'qwen' | custom
  label         TEXT NOT NULL,               -- user-readable name
  base_url      TEXT NOT NULL,               -- API endpoint
  model         TEXT NOT NULL,               -- default model name
  api_key_enc   BLOB,                        -- safeStorage-encrypted ciphertext (NULL = not yet configured / stripped)
  key_iv_hint   TEXT,                        -- platform/algorithm hint for diagnostics ('fallback-aes-machinebound' | NULL)
  is_active     INTEGER NOT NULL DEFAULT 0,  -- 1 = currently selected provider
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_credentials_provider ON api_credentials(provider);
CREATE INDEX IF NOT EXISTS idx_credentials_active   ON api_credentials(is_active) WHERE is_active = 1;
