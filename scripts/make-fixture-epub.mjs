// Generates a minimal but valid EPUB fixture for integration tests / S8.3 regression.
// Run: node scripts/make-fixture-epub.mjs  →  fixtures/sample.epub
import AdmZip from 'adm-zip'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

const out = join(process.cwd(), 'fixtures', 'sample.epub')
mkdirSync(dirname(out), { recursive: true })

const container = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`

const opf = `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>神农本草经（测试）</dc:title>
    <dc:creator>佚名</dc:creator>
    <dc:identifier id="bookid">urn:uuid:test-1</dc:identifier>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch2" href="ch2.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine toc="ncx">
    <itemref idref="ch1"/>
    <itemref idref="ch2"/>
  </spine>
</package>`

const ncx = `<?xml version="1.0"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <navMap>
    <navPoint id="n1"><navLabel><text>上品</text></navLabel><content src="ch1.xhtml"/></navPoint>
    <navPoint id="n2"><navLabel><text>中品</text></navLabel><content src="ch2.xhtml"/></navPoint>
  </navMap>
</ncx>`

const ch1 = `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>上品</title></head><body>
<h1>上品</h1>
<p>人参，味甘微寒。主补五脏，安精神，定魂魄。</p>
<p>久服轻身延年。一名人衔。</p>
</body></html>`

const ch2 = `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>中品</title></head><body>
<h1>中品</h1>
<p>甘草，味甘平。主五脏六腑寒热邪气。</p>
</body></html>`

const zip = new AdmZip()
zip.addFile('mimetype', Buffer.from('application/epub+zip'))
zip.addFile('META-INF/container.xml', Buffer.from(container))
zip.addFile('OEBPS/content.opf', Buffer.from(opf))
zip.addFile('OEBPS/toc.ncx', Buffer.from(ncx))
zip.addFile('OEBPS/ch1.xhtml', Buffer.from(ch1))
zip.addFile('OEBPS/ch2.xhtml', Buffer.from(ch2))
zip.writeZip(out)
console.log('wrote', out)
