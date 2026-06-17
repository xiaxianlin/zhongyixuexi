import type { DB } from './connection'

/**
 * Rebuilds the fts_paragraphs index from the full paragraphs content table.
 *
 * Used after bulk built-in content writes or post-cascade-delete cleanup since
 * FK CASCADE deletes do NOT fire the ai/ad/au triggers in SQLite.
 *
 * The FTS5 'rebuild' command reads every row of the external content table
 * (paragraphs) and re-populates the index. Call inside the surrounding write
 * transaction.
 */
export function rebuildFts(db: DB): void {
  db.exec(`INSERT INTO fts_paragraphs(fts_paragraphs) VALUES ('rebuild');`)
}
