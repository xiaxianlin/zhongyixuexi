import { handle } from './registry'
import * as segment from '../services/segment'

/** Segment-level editing IPC (IMP-03). Thin pass-throughs to the segment service. */
export function registerSegmentHandlers(): void {
  handle('segment:list', (_event, chapterId: unknown) =>
    segment.getChapterParagraphs(chapterId as string),
  )

  handle('segment:updateText', (_event, id: unknown, text: unknown) => {
    segment.updateParagraphText(id as string, text as string)
    return null
  })

  handle('segment:delete', (_event, id: unknown) => {
    segment.deleteParagraph(id as string)
    return null
  })

  handle('segment:mergeNext', (_event, id: unknown) => {
    segment.mergeWithNext(id as string)
    return null
  })

  handle('segment:split', (_event, id: unknown, offset: unknown) => {
    segment.splitParagraph(id as string, offset as number)
    return null
  })

  handle('segment:setNoise', (_event, id: unknown, isNoise: unknown) => {
    segment.setNoise(id as string, Boolean(isNoise))
    return null
  })
}
