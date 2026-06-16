import type { DB } from './connection'

/**
 * Rebuilds the fts_paragraphs index from the full paragraphs content table.
 *
 * Used by the IMP module after bulk operations (re-parse IMP-07, book import,
 * or post-cascade-delete cleanup since FK CASCADE deletes do NOT fire the
 * ai/ad/au triggers in SQLite). 00-architecture §5.4: fts_paragraphs sync is
 * owned by IMP; this is the batch rebuild entry point (05-search.md §7.1).
 *
 * The FTS5 'rebuild' command reads every row of the external content table
 * (paragraphs) and re-populates the index. Call inside an IMP transaction.
 */
export function rebuildFts(db: DB): void {
  db.exec(`INSERT INTO fts_paragraphs(fts_paragraphs) VALUES ('rebuild');`)
}
