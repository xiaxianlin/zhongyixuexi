import { describe, it, expect } from 'vitest'
import {
  parseContainerXml,
  parseOpf,
  parseNcx,
  parseNavXhtml,
  extractChapterHead,
} from './epub'

const CONTAINER = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`

const OPF = `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>神农本草经</dc:title>
    <dc:creator>佚名</dc:creator>
    <dc:identifier id="bookid">urn:uuid:1</dc:identifier>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch2" href="text/ch2.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine toc="ncx">
    <itemref idref="ch1"/>
    <itemref idref="ch2"/>
  </spine>
</package>`

const NCX = `<?xml version="1.0"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <navMap>
    <navPoint id="n1"><navLabel><text>上品</text></navLabel><content src="ch1.xhtml"/></navPoint>
    <navPoint id="n2">
      <navLabel><text>中品</text></navLabel><content src="text/ch2.xhtml"/>
      <navPoint id="n2a"><navLabel><text>人参</text></navLabel><content src="text/ch2.xhtml#renshen"/></navPoint>
    </navPoint>
  </navMap>
</ncx>`

const NAV = `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <body>
    <nav epub:type="toc">
      <ol>
        <li><a href="ch1.xhtml">上品</a></li>
        <li><a href="text/ch2.xhtml">中品</a>
          <ol><li><a href="text/ch2.xhtml#renshen">人参</a></li></ol>
        </li>
      </ol>
    </nav>
  </body>
</html>`

describe('parseContainerXml', () => {
  it('reads the rootfile full-path', () => {
    expect(parseContainerXml(CONTAINER)).toBe('OEBPS/content.opf')
  })
})

describe('parseOpf', () => {
  it('parses metadata, manifest, spine, toc refs', () => {
    const opf = parseOpf(OPF)
    expect(opf.title).toBe('神农本草经')
    expect(opf.creator).toBe('佚名')
    expect(opf.spine).toEqual(['ch1', 'ch2'])
    expect(opf.manifest['ch1'].href).toBe('ch1.xhtml')
    expect(opf.manifest['ch2'].href).toBe('text/ch2.xhtml')
    expect(opf.ncxId).toBe('ncx')
    expect(opf.navHref).toBe('nav.xhtml')
  })
})

describe('parseNcx', () => {
  it('builds a nested toc tree', () => {
    const tree = parseNcx(NCX)
    expect(tree).toEqual([
      { label: '上品', href: 'ch1.xhtml', children: [] },
      {
        label: '中品',
        href: 'text/ch2.xhtml',
        children: [{ label: '人参', href: 'text/ch2.xhtml#renshen', children: [] }],
      },
    ])
  })
})

describe('parseNavXhtml', () => {
  it('builds a nested toc tree from the EPUB3 nav', () => {
    const tree = parseNavXhtml(NAV)
    expect(tree).toEqual([
      { label: '上品', href: 'ch1.xhtml', children: [] },
      {
        label: '中品',
        href: 'text/ch2.xhtml',
        children: [{ label: '人参', href: 'text/ch2.xhtml#renshen', children: [] }],
      },
    ])
  })
})

describe('extractChapterHead', () => {
  it('reads title and first h1, stripping tags', () => {
    const xhtml = `<html><head><title>第一章 上品</title></head>
      <body><h1 class="c">上品总论</h1><p>正文</p></body></html>`
    expect(extractChapterHead(xhtml)).toEqual({ title: '第一章 上品', h1: '上品总论' })
  })
})
