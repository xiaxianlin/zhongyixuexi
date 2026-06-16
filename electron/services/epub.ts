import { dirname } from 'node:path'
import { XMLParser } from 'fast-xml-parser'
import StreamZip from 'node-stream-zip'

/**
 * EPUB parsing. The pure parsers (parseContainerXml / parseOpf / parseNcx /
 * parseNavXhtml / extractChapterHead) take XML strings and are unit-tested.
 * parseEpub is the thin I/O orchestrator over the zip (exercised at import time).
 */

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' })

export interface TocNode {
  label: string
  href: string
  children: TocNode[]
}

export interface ParsedChapter {
  id: string
  href: string // absolute path within the zip
  title: string
  xhtml: string
}

export interface ParsedEpub {
  title: string
  creator: string
  chapters: ParsedChapter[]
}

interface OpfManifestItem {
  id: string
  href: string
  mediaType: string
  properties?: string
}

interface ParsedOpf {
  title?: string
  creator?: string
  manifest: Record<string, OpfManifestItem>
  spine: string[] // idrefs in reading order
  ncxId?: string
  navHref?: string
}

// ---------- helpers ----------

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined || value === null) return []
  return Array.isArray(value) ? value : [value]
}

function textOf(node: unknown): string | undefined {
  if (node === undefined || node === null) return undefined
  if (typeof node === 'string') return node
  if (typeof node === 'object') {
    const obj = node as Record<string, unknown>
    if (typeof obj['#text'] === 'string') return obj['#text']
  }
  return undefined
}

function attr(node: unknown, name: string): string | undefined {
  if (node && typeof node === 'object') {
    const v = (node as Record<string, unknown>)[`@_${name}`]
    if (typeof v === 'string') return v
  }
  return undefined
}

/** Resolves a relative href against the OPF directory using posix separators. */
function resolveHref(dir: string, href: string): string {
  const clean = href.replace(/\\/g, '/')
  if (clean.startsWith('/')) return clean.slice(1)
  const parts = [...dir.split('/').filter(Boolean), ...clean.split('/')]
  const stack: string[] = []
  for (const part of parts) {
    if (part === '.' || part === '') continue
    if (part === '..') stack.pop()
    else stack.push(part)
  }
  return stack.join('/')
}

function stripAnchor(href: string): string {
  return href.split('#')[0]
}

// ---------- pure parsers ----------

export function parseContainerXml(xml: string): string {
  const obj = parser.parse(xml) as Record<string, unknown>
  const container = obj.container as Record<string, unknown> | undefined
  const rootfiles = container?.rootfiles as Record<string, unknown> | undefined
  const rootfile = asArray(rootfiles?.rootfile as unknown)[0]
  return attr(rootfile, 'full-path') ?? 'OEBPS/content.opf'
}

export function parseOpf(xml: string): ParsedOpf {
  const obj = parser.parse(xml) as Record<string, unknown>
  const pkg = (obj.package as Record<string, unknown>) ?? obj
  const meta = (pkg.metadata as Record<string, unknown>) ?? {}

  const title = textOf(meta['dc:title']) ?? textOf(meta.title)
  const creator = textOf(meta['dc:creator']) ?? textOf(meta.creator)

  const manifestItems = asArray(
    (pkg.manifest as Record<string, unknown> | undefined)?.item as unknown,
  )
  const manifest: Record<string, OpfManifestItem> = {}
  let navHref: string | undefined
  let ncxId: string | undefined
  for (const item of manifestItems) {
    const id = attr(item, 'id')!
    const entry: OpfManifestItem = {
      id,
      href: attr(item, 'href') ?? '',
      mediaType: attr(item, 'media-type') ?? '',
      properties: attr(item, 'properties'),
    }
    manifest[id] = entry
    if (entry.properties?.includes('nav')) navHref = entry.href
    if (entry.mediaType === 'application/x-dtbncx+xml') ncxId = id
  }

  const spineNode = pkg.spine as Record<string, unknown> | undefined
  const spine = asArray(spineNode?.itemref as unknown).map((ir) => attr(ir, 'idref')!)
  // EPUB2 may declare the ncx via spine toc attribute → resolve to id by manifest
  const spineTocAttr = attr(spineNode, 'toc')
  if (spineTocAttr && manifest[spineTocAttr]?.mediaType === 'application/x-dtbncx+xml') {
    ncxId = ncxId ?? spineTocAttr
  }

  return { title, creator, manifest, spine, ncxId, navHref }
}

function navPointsToTree(navPoints: unknown[]): TocNode[] {
  return navPoints.map((np) => {
    const node = np as Record<string, unknown>
    const navLabel = node.navLabel as Record<string, unknown> | undefined
    const label = textOf(navLabel?.text) ?? ''
    const content = node.content as Record<string, unknown> | undefined
    const href = attr(content, 'src') ?? ''
    const children = navPointsToTree(asArray(node.navPoint as unknown))
    return { label, href, children }
  })
}

export function parseNcx(xml: string): TocNode[] {
  const obj = parser.parse(xml) as Record<string, unknown>
  const ncx = (obj.ncx as Record<string, unknown>) ?? obj
  const navMap = ncx.navMap as Record<string, unknown> | undefined
  return navPointsToTree(asArray(navMap?.navPoint as unknown))
}

function olToTree(ol: unknown): TocNode[] {
  const lis = asArray((ol as Record<string, unknown>)?.li as unknown)
  const nodes: TocNode[] = []
  for (const li of lis) {
    const liObj = li as Record<string, unknown>
    const a = liObj.a as Record<string, unknown> | undefined
    const label = textOf(a) ?? ''
    const href = attr(a, 'href') ?? ''
    const children = liObj.ol ? olToTree(liObj.ol) : []
    nodes.push({ label, href, children })
  }
  return nodes
}

export function parseNavXhtml(xml: string): TocNode[] {
  const obj = parser.parse(xml) as Record<string, unknown>
  const html = (obj.html as Record<string, unknown>) ?? obj
  const body = (html.body as Record<string, unknown>) ?? html
  // find first <nav> (EPUB3 toc is the nav with epub:type="toc"; take first nav as fallback)
  const navs = asArray(body.nav as unknown)
  const tocNav =
    navs.find(
      (n) =>
        attr(n, 'epub:type')?.includes('toc') ||
        attr(n, 'type')?.includes('toc') ||
        attr(n, 'data-type') === 'toc',
    ) ?? navs[0]
  const tocObj = tocNav as Record<string, unknown> | undefined
  return tocObj?.ol ? olToTree(tocObj.ol) : []
}

/** Extracts <title> and first <h1> from a chapter xhtml string. */
export function extractChapterHead(xhtml: string): { title?: string; h1?: string } {
  const titleMatch = xhtml.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  const h1Match = xhtml.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)
  const stripTags = (s: string) => s.replace(/<[^>]+>/g, '').trim()
  return {
    title: titleMatch ? stripTags(titleMatch[1]) : undefined,
    h1: h1Match ? stripTags(h1Match[1]) : undefined,
  }
}

// ---------- orchestrator ----------

export async function parseEpub(filePath: string): Promise<ParsedEpub> {
  const zip = new StreamZip.async({ file: filePath })
  const read = (name: string): Promise<string> =>
    zip.entryData(name).then((buf) => buf.toString('utf8'))
  try {
    const containerXml = await read('META-INF/container.xml')
    const opfPath = parseContainerXml(containerXml)
    const opfDir = dirname(opfPath).replace(/\\/g, '/')
    const opf = parseOpf(await read(opfPath))

    // resolve toc tree (prefer EPUB3 nav, fall back to NCX)
    let toc: TocNode[] = []
    if (opf.navHref) {
      toc = parseNavXhtml(await read(resolveHref(opfDir, opf.navHref)))
    } else if (opf.ncxId && opf.manifest[opf.ncxId]) {
      toc = parseNcx(await read(resolveHref(opfDir, opf.manifest[opf.ncxId].href)))
    }
    const labelByHref = new Map<string, string>()
    const walk = (nodes: TocNode[]): void => {
      for (const n of nodes) {
        if (!labelByHref.has(stripAnchor(n.href))) labelByHref.set(stripAnchor(n.href), n.label)
        walk(n.children)
      }
    }
    walk(toc)

    const chapters: ParsedChapter[] = []
    for (const idref of opf.spine) {
      const item = opf.manifest[idref]
      if (!item) continue
      const fullHref = resolveHref(opfDir, item.href)
      const xhtml = await read(fullHref)
      const head = extractChapterHead(xhtml)
      const label = labelByHref.get(stripAnchor(item.href))
      chapters.push({
        id: item.id,
        href: fullHref,
        title: label ?? head.h1 ?? head.title ?? `第 ${chapters.length + 1} 章`,
        xhtml,
      })
    }

    return { title: opf.title ?? '未命名', creator: opf.creator ?? '', chapters }
  } finally {
    await zip.close()
  }
}
