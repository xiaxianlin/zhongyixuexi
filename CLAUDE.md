# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

A local-first **PC desktop app for studying 中医 (Chinese-medicine) classics** — users import EPUB books, the app parses them into chapters/paragraphs and adds AI modern-language commentary, spaced-repetition memory cards, search, and notes. Electron + React + TypeScript. Local-only: no server, no accounts, no cloud sync; the only network use is the AI API (DeepSeek by default, user-supplied key).

## Commands

- `npm run dev` — electron-vite dev (HMR for main + preload + renderer)
- `npm run build` — production build to `out/` (main `index.js`, preload `index.js`, renderer bundle)
- `npm run typecheck` — `tsc` for both the Node side and the web side
- `npm run lint` — ESLint (flat config, `eslint.config.mjs`)
- `npm run test` — Vitest (`**/*.test.ts`)
- `npm run check` — **the quality gate**: typecheck + lint + test. Run before committing; a slice is not done until this is green.
- Single test: `npx vitest run path/to/file.test.ts` or `npx vitest run -t "partial name"`
- After touching native deps: `npx electron-rebuild -f -w better-sqlite3` (better-sqlite3 must match Electron's ABI, not the host Node's)

## Architecture (big picture)

**Two-process Electron app, intentionally CJS at the main level.** `package.json` has **no `"type": "module"`** — this is deliberate so electron-vite emits main and preload as `index.js` (CJS) and `electron/main/index.ts` can load `../preload/index.js` reliably with native `__dirname`. The renderer is still ESM via Vite. Do not re-add `"type": "module"` without also fixing the preload filename.

**Two TypeScript roots**, both referenced by `tsconfig.json`:
- `tsconfig.node.json` → `electron/**` + config files (main process)
- `tsconfig.web.json` → `src/**` (renderer), with `@/*` → `src/*` path alias

**`electron/` (main process, Node):**
- `main/` — app/window lifecycle; wires `runMigrations()` + `registerAllIpc()` on ready, `closeDb()` on quit
- `preload/` — the *only* surface exposed to the renderer via `contextBridge` (`contextIsolation: true`, `nodeIntegration: false`). Exposes `window.api.{invoke, on}` only.
- `db/` — better-sqlite3 singleton in `userData/app.db` + forward-only migration runner
- `ipc/` — channel registry; `services/` — business logic (one file per module); `lib/error.ts` — `AppError`; `ai/` — DeepSeek client (planned)

**`src/` (renderer, React):** `modules/<feature>/`, `stores/` (Zustand), `lib/ipc.ts` (typed wrappers). Module stores hold session/UI cache only — **persisted data always lives in SQLite, never in store persistence**.

**IPC envelope pattern (read this before adding a channel).** `electron/ipc/registry.ts` wraps `ipcMain.handle` so every handler returns `{ __ok: true, data } | { __ok: false, error: SerializedError }`. `src/lib/ipc.ts` unwraps it and throws `IpcError` (with `.code`). This avoids Electron's version-dependent error serialization. New work: register with `handle('module:action', fn)` in `electron/ipc/`, add a typed wrapper in `src/lib/ipc.ts`. Channel names are `module:action`.

**DB layer.** better-sqlite3 runs only in the main process; the renderer never writes SQL — it goes through IPC → `services/`. Every connection sets `journal_mode=WAL` and `foreign_keys=ON`.

## Loop engineering workflow

Development proceeds **slice-by-slice**, driven by `docs/dev/PROGRESS.md` (the single source of progress truth) per `docs/dev/loop-engineering.md`:
- Pick the first `todo` slice, implement following `docs/dev/00-architecture.md`, get `npm run check` green, update `PROGRESS.md` (`todo → done` + outputs + decisions), then commit.
- **One slice per commit**, conventional-commit message tagged with the slice ID, e.g. `feat(db): better-sqlite3 + migrations (S0.3)`.
- Work commits to `main`. Read `PROGRESS.md` before starting; the eight module design docs (`docs/dev/01-*.md` … `08-*.md`) detail each module's schema, IPC, and flows.

## Agent team (parallel module development)

Six module-owner subagents live in `.claude/agents/dev-{rd,ai,srh,set,lrn,note}.md` for parallel development. The **main agent orchestrates** (subagents cannot spawn subagents). `docs/dev/agent-team.md` holds the file-ownership matrix, cross-module contracts, parallel waves, and the integration protocol. Pattern: spawn the relevant module agents in one message (they own disjoint files), then integrate the shared files (`electron/ipc/index.ts`, `electron/db/migrate.ts`, `src/App.tsx`) yourself and run `npm run check`. New `.claude/agents/*.md` require a session restart to load.

## Cross-cutting hard constraints (docs/dev/00-architecture.md §5)

These are correctness invariants — violating them silently breaks cascades, FTS, or data references:
- `PRAGMA foreign_keys = ON` on every connection (SQLite defaults it OFF; without it all `ON DELETE CASCADE` silently no-ops).
- `paragraphs` has **both** a `TEXT PRIMARY KEY` stable id (UUID, app-generated) **and** the implicit `rowid` (used by FTS5 `content_rowid`). Migrations must not drop or regenerate either.
- Child tables referencing `paragraph_id`/`chapter_id`/`book_id` must declare `ON DELETE CASCADE` (or `SET NULL` where the row should survive — e.g. a note outliving its paragraph).
- `fts_paragraphs` synchronization is owned by the **IMP module only**; do not write to it elsewhere (except batch rebuild).
- Migrations are forward-only and must not `DROP`/regenerate stable IDs (paragraph/chapter edits preserve IDs via `parse_hash`).
