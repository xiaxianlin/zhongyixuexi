/**
 * Reading data service for the current library detail UI.
 *
 * The old standalone reading workbench is gone; this service now only returns
 * chapter paragraphs with the active paragraph analysis joined in.
 */

import { getDb } from '../db'
import {
  activeAnalysisSql,
  mapParagraphAnalysisView,
  toParagraphInterpretationView,
  type ParagraphAnalysisSqlRow,
  type ParagraphInterpretationView,
} from './paragraph-analysis'

export interface ParagraphDTO {
  id: string
  chapter_id: string
  order_index: number
  text: string
  interpretation: ParagraphInterpretationView
  edited: number
  is_noise: number
}

export interface ChapterDTO {
  id: string
  book_id: string
  parent_id: string | null
  order_index: number
  level: string | null
  title: string
}

export interface ChapterContent {
  chapter: ChapterDTO
  paragraphs: ParagraphDTO[]
}

type ParagraphRow = Omit<ParagraphDTO, 'interpretation'> & ParagraphAnalysisSqlRow

export function getChapter(bookId: string, chapterId: string): ChapterContent | null {
  const db = getDb()
  const chapter = db
    .prepare(
      `SELECT id, book_id, parent_id, order_index, level, title
       FROM chapters
       WHERE id = ? AND book_id = ? AND deleted_at IS NULL`,
    )
    .get(chapterId, bookId) as ChapterDTO | undefined
  if (!chapter) return null

  const activeAnalysis = activeAnalysisSql()
  const rows = db
    .prepare(
      `SELECT p.id,
              p.chapter_id,
              p.order_index,
              p.text,
              ${activeAnalysis.columns},
              p.edited,
              p.is_noise
       FROM paragraphs p
       ${activeAnalysis.join}
       WHERE p.chapter_id = ? AND p.deleted_at IS NULL
       ORDER BY p.order_index`,
    )
    .all(chapterId) as ParagraphRow[]

  return {
    chapter,
    paragraphs: rows.map((paragraph) => ({
      id: paragraph.id,
      chapter_id: paragraph.chapter_id,
      order_index: paragraph.order_index,
      text: paragraph.text,
      edited: paragraph.edited,
      is_noise: paragraph.is_noise,
      interpretation: toParagraphInterpretationView(mapParagraphAnalysisView(paragraph)),
    })),
  }
}
