const MAX_QUERY_LENGTH = 100

/**
 * Trim and cap the raw query. Unlike the old SQLite FTS5 trigram tokenizer —
 * which couldn't form a trigram MATCH term below 3 characters and needed an
 * explicit LIKE-scan fallback (SRH-02) — Postgres's ILIKE against a
 * pg_trgm-indexed column works uniformly at any length (the planner just
 * falls back to a sequential scan for very short patterns on its own), so
 * there's no separate short-query code path to maintain here.
 */
export function sanitizeSearchQuery(rawQuery: string): string {
  return rawQuery.trim().slice(0, MAX_QUERY_LENGTH)
}
