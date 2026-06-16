# Notes: Project Deep Research

## Sources

### Local Instructions
- `AGENTS.md`
- Key points:
  - Project is a local-first PC desktop app for studying Chinese-medicine classics.
  - Electron + React + TypeScript; main/preload intentionally CJS because package has no `"type": "module"`.
  - SQLite is the persisted source of truth; renderer stores are session/UI cache only.
  - IPC must use the `{ __ok }` envelope via `electron/ipc/registry.ts`.
  - Critical constraints: SQLite foreign keys on, paragraph stable `TEXT PRIMARY KEY` plus implicit `rowid`, cascading child FKs, FTS writes owned by IMP, migrations forward-only.

### Product Requirements
- Source: `docs/PRD.md`
- Key points:
  - Product promise: local-first, no accounts/cloud/server, only AI API network access.
  - EPUB import and parsing are P0 and should work offline.
  - AI is an enhancement layer for interpretation, Q&A, and card generation.
  - PRD explicitly states import/parsing itself does not depend on AI.
  - Stable paragraph/chapter IDs must survive reparse/edit so notes/cards/AI interpretation references are not broken.

### Architecture
- Source: `docs/dev/00-architecture.md`
- Key points:
  - Two TS roots: Electron Node side and renderer web side.
  - Main process owns DB, parsing, services, and AI HTTP.
  - Renderer invokes typed IPC wrappers.
  - `better-sqlite3` connection must set WAL and foreign keys.
  - FTS external-content table uses paragraphs implicit `rowid`.

### Progress Tracker
- Source: `docs/dev/PROGRESS.md`
- Key points:
  - Phase 0-7 are marked done.
  - Remaining work is Phase 8: electron-builder packaging, update strategy, EPUB fixture regression suite.
  - Some completed slices still mention placeholders, such as reading layout persistence and pinyin/simplified toggles.
  - S4.4 explicitly records `triggerReparse` as not implemented and throwing `CONFLICT`.

### Code Inspection
- `electron/db/connection.ts`: WAL and `PRAGMA foreign_keys = ON` are set.
- `electron/ipc/registry.ts`: IPC envelope is implemented.
- `electron/db/migrate.ts`: schema v1-v9 covers content, FTS, dictionary, reading, settings, learning, notes, and AI cache.
- `electron/services/import.ts`: current import path requires API key and AI-parses the whole book before writing chapters/paragraphs.
- `src/App.tsx`: current app forces AI provider setup before the app is usable.
- `electron/services/settings.ts`: `triggerReparse` still throws `CONFLICT`.
- No `electron-builder.yml` found; `.nvmrc` exists and pins Node 22.

### Quality Gate
- Command: `npm run check`
- Result: passed.
- Details:
  - Typecheck passed.
  - ESLint passed.
  - Vitest passed: 16 files, 203 tests.
  - npm emitted mirror config warnings, but they did not fail the check.

### Worktree Status
- Pre-existing modified files:
  - `electron/ai/prompts.ts`
  - `electron/ipc/import.ts`
  - `electron/services/ai.ts`
  - `electron/services/import.ts`
  - `src/modules/library/LibraryView.tsx`
- Pre-existing untracked:
  - `.codex/`
  - `AGENTS.md`
- Research files added by this task:
  - `task_plan.md`
  - `notes.md`
  - `project_research_report.md`

## Synthesized Findings

### Product/Architecture Alignment
- The broad architecture is healthy: Electron main owns DB and services, renderer talks through typed IPC, foreign keys are enabled, and quality gate is green.
- The biggest strategic mismatch is AI becoming a hard dependency for app onboarding and EPUB import. This conflicts with the local-first/offline MVP promise.
- Reparse is split-brain: there is a `reparseBook` implementation in IMP, but SET's `triggerReparse` still says IMP-07 is not implemented. The current reparse implementation also regenerates paragraph IDs and cascades downstream rows, which conflicts with stable-ID preservation.

### Implementation Completeness
- Functional breadth is high for a prototype: import, library, reading, search, settings, AI, learning, notes, and backup services exist.
- Release readiness is not there yet: packaging config is absent, update strategy is not implemented, and the EPUB regression suite remains a todo.
- Several P0/P1 user-facing capabilities are shallow or partial despite phases marked done, including chapter-level editing, metadata editing, layout persistence, simplified/pinyin rendering, and reparse stability.

### Risk Ranking
- Critical: AI hard-gating import and app usage breaks local-first/offline requirements.
- Critical: reparse destroys stable IDs/downstream references, contrary to PRD reliability requirements.
- High: whole-book AI parsing is brittle for long EPUBs due to output-token truncation and all-or-nothing failure.
- High: no release packaging configuration despite Phase 8 being the only remaining planned phase.
- Medium: progress aggregation in library remains hard-coded to 0.
- Medium: UX has multiple placeholders that may make the app look more complete in docs than in product.

### Recommended Next Slices
- Restore offline deterministic EPUB import as the default path; optionally add AI cleanup as an opt-in enhancement.
- Implement stable-ID-preserving reparse or keep reparse disabled consistently across UI/services until implemented.
- Add packaging config and smoke-test generated macOS/Windows artifacts.
- Build an EPUB fixture regression suite with normal, messy, large, and non-content-heavy books.
- Update `PROGRESS.md` to reflect partial/placeholder items truthfully.

### Fix Applied 2026-06-16
- EPUB import now uses the local `parseEpub + splitParagraphs` path by default and no longer requires an AI key.
- App startup no longer forces provider setup; AI remains optional/degraded.
- `reparseBook` now preserves stable IDs where it can, matching chapters by content hash/title/order and paragraphs by parse hash/order.
- Unmatched old chapters/paragraphs are soft-deleted instead of hard-deleted, reducing downstream reference loss.
- SET `triggerReparse` delegates to IMP reparse.
- Quality gate after the fix: `npm run check` passed with 207 tests.
