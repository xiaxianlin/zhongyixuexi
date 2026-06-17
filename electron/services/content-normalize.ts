/** text.trim().replace(/\s+/g,' ') — the canonical form hashed for parse_hash. */
export function normalize(text: string): string {
  return text.trim().replace(/\s+/g, ' ')
}
