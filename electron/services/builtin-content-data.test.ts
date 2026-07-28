import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

interface BuiltinDataFile {
  quality?: {
    chapterCount?: number
    paragraphCount?: number
  }
  chapters: {
    title: string
    paragraphs: {
      text: string
    }[]
  }[]
}

const DATA_DIR = join(process.cwd(), 'data')
const FOOTER_PATTERN =
  /Public domain|false false|Creative Commons|Wikisource|此作品在全世界都属于\s*公有领域/i

describe('builtin content data', () => {
  for (const fileName of readdirSync(DATA_DIR).filter((f) => f.endsWith('-original.json'))) {
    it(`${fileName} has consistent counts and no source-page footer text`, () => {
      const file = JSON.parse(readFileSync(join(DATA_DIR, fileName), 'utf8')) as BuiltinDataFile
      const paragraphCount = file.chapters.reduce(
        (sum, chapter) => sum + chapter.paragraphs.length,
        0,
      )

      expect(file.quality?.chapterCount).toBe(file.chapters.length)
      expect(file.quality?.paragraphCount).toBe(paragraphCount)

      const polluted = file.chapters.flatMap((chapter) =>
        chapter.paragraphs
          .filter((paragraph) => FOOTER_PATTERN.test(paragraph.text))
          .map((paragraph) => `${chapter.title}: ${paragraph.text}`),
      )
      expect(polluted).toEqual([])
    })
  }
})
