import { crc32, deflateRawSync } from 'node:zlib'
import type { Report, ReportBlock } from '@scbrowser/shared'

/** Text that XML can't hold at all, plus the characters it treats as markup. */
const xml = (text: string) =>
  text
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

const run = (text: string) => `<w:r><w:t xml:space="preserve">${xml(text)}</w:t></w:r>`
const para = (text: string, style?: string, extra = '') => `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}${extra}</w:pPr>${run(text)}</w:p>`

const BORDER = 'w:val="single" w:sz="4" w:space="0" w:color="CFCFCF"'

function table(block: Extract<ReportBlock, { type: 'table' }>): string {
  const columns = Math.max(block.headers.length, ...block.rows.map((row) => row.length))
  const width = Math.floor(9000 / columns)
  const cell = (text: string, header: boolean) =>
    `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${header ? '<w:shd w:val="clear" w:color="auto" w:fill="F3F3F3"/>' : ''}</w:tcPr>${para(text, header ? 'TableHead' : undefined)}</w:tc>`
  const row = (cells: string[], header: boolean) =>
    `<w:tr>${header ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}${Array.from({ length: columns }, (_, index) => cell(cells[index] ?? '', header)).join('')}</w:tr>`
  const borders = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map((side) => `<w:${side} ${BORDER}/>`).join('')
  return `<w:tbl><w:tblPr><w:tblW w:w="9000" w:type="dxa"/><w:tblBorders>${borders}</w:tblBorders></w:tblPr><w:tblGrid>${`<w:gridCol w:w="${width}"/>`.repeat(columns)}</w:tblGrid>${row(block.headers, true)}${block.rows.map((cells) => row(cells, false)).join('')}</w:tbl><w:p/>`
}

/** Every numbered list gets its own number, so each one starts again from 1. */
function body(report: Report): { xml: string; numbered: number } {
  let numbered = 0
  const blocks = report.blocks.map((block) => {
    switch (block.type) {
      case 'heading':
        return para(block.text, block.level === 3 ? 'Heading2' : 'Heading1')
      case 'paragraph':
        return para(block.text)
      case 'quote':
        return para(block.text, 'Quote')
      case 'callout':
        return para(block.text, 'Callout')
      case 'list': {
        const id = block.ordered ? ++numbered + 1 : 1
        return block.items.map((item) => para(item, 'ListParagraph', `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="${id}"/></w:numPr>`)).join('')
      }
      case 'table':
        return table(block)
      case 'spacer':
        return '<w:p/>'
      case 'divider':
        return `<w:p><w:pPr><w:pBdr><w:bottom ${BORDER}/></w:pBdr></w:pPr></w:p>`
      // Word has no tiles or timelines, so these become the nearest plain shapes.
      case 'stats':
        return table({ type: 'table', headers: block.items.map((item) => item.value), rows: [block.items.map((item) => item.label)] })
      case 'timeline':
        return table({ type: 'table', headers: ['When', 'What'], rows: block.items.map((item) => [item.when, item.text]) })
      case 'proscons':
        return table({ type: 'table', headers: ['Pros', 'Cons'], rows: Array.from({ length: Math.max(block.pros.length, block.cons.length) }, (_, i) => [block.pros[i] ?? '', block.cons[i] ?? '']) })
      case 'cards':
        return block.items.map((item) => para(item.title, 'Heading2') + para(item.text)).join('')
      case 'steps': {
        const id = ++numbered + 1
        return block.items.map((item) => para(`${item.title}: ${item.text}`, 'ListParagraph', `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="${id}"/></w:numPr>`)).join('')
      }
    }
  })
  return { xml: [...(report.kind ? [para(report.kind, 'Subtitle')] : []), para(report.title, 'Title'), ...(report.summary ? [para(report.summary, 'Subtitle')] : []), ...blocks].join(''), numbered }
}

const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
const FONT = '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/>'

const style = (id: string, name: string, paragraph: string, text: string) =>
  `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr>${paragraph}</w:pPr><w:rPr>${text}</w:rPr></w:style>`

const STYLES = `${HEAD}<w:styles ${NS}><w:docDefaults><w:rPrDefault><w:rPr>${FONT}<w:sz w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>${[
  style('Title', 'Title', '<w:spacing w:after="80"/>', '<w:b/><w:sz w:val="48"/>'),
  style('Subtitle', 'Subtitle', '<w:spacing w:after="240"/>', '<w:color w:val="555555"/><w:sz w:val="24"/>'),
  style('Heading1', 'heading 1', '<w:keepNext/><w:spacing w:before="320" w:after="100"/><w:outlineLvl w:val="0"/>', '<w:b/><w:sz w:val="32"/>'),
  style('Heading2', 'heading 2', '<w:keepNext/><w:spacing w:before="200" w:after="80"/><w:outlineLvl w:val="1"/>', '<w:b/><w:sz w:val="26"/>'),
  style('Quote', 'Quote', `<w:pBdr><w:left w:val="single" w:sz="12" w:space="10" w:color="CFCFCF"/></w:pBdr><w:ind w:left="200"/>`, '<w:color w:val="555555"/>'),
  style('Callout', 'Callout', '<w:pBdr><w:left w:val="single" w:sz="12" w:space="8" w:color="4FA3B5"/></w:pBdr><w:shd w:val="clear" w:color="auto" w:fill="E8F3F5"/><w:ind w:left="160"/>', ''),
  style('ListParagraph', 'List Paragraph', '<w:spacing w:after="60"/>', ''),
  style('TableHead', 'Table Head', '<w:spacing w:after="0"/>', '<w:b/><w:color w:val="555555"/><w:sz w:val="20"/>')
].join('')}</w:styles>`

const level = (format: string, text: string, font = '') =>
  `<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="${format}"/><w:lvlText w:val="${text}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="400" w:hanging="280"/></w:pPr>${font}</w:lvl>`

const numbering = (numbered: number) =>
  `${HEAD}<w:numbering ${NS}><w:abstractNum w:abstractNumId="0">${level('bullet', '•')}</w:abstractNum><w:abstractNum w:abstractNumId="1">${level('decimal', '%1.')}</w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>${Array.from(
    { length: numbered },
    (_, index) => `<w:num w:numId="${index + 2}"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>`
  ).join('')}</w:numbering>`

const CONTENT_TYPES = `${HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>`
const ROOT_RELS = `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`
const DOC_RELS = `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/></Relationships>`

/** A zip file, which is all a Word document is on the outside. */
function zip(files: [string, string][]): Buffer {
  const locals: Buffer[] = []
  const directory: Buffer[] = []
  let offset = 0
  for (const [name, text] of files) {
    const data = Buffer.from(text, 'utf8')
    const packed = deflateRawSync(data)
    const nameBytes = Buffer.from(name)
    const common = Buffer.alloc(26)
    common.writeUInt16LE(20, 0) // version needed
    common.writeUInt16LE(0x0800, 2) // names are UTF-8
    common.writeUInt16LE(8, 4) // deflate
    common.writeUInt16LE(0x0021, 8) // 1 January 1980, as a fixed date
    common.writeUInt32LE(crc32(data), 10)
    common.writeUInt32LE(packed.length, 14)
    common.writeUInt32LE(data.length, 18)
    common.writeUInt16LE(nameBytes.length, 22)
    const local = Buffer.concat([Buffer.from([0x50, 0x4b, 3, 4]), common, nameBytes, packed])
    const tail = Buffer.alloc(14)
    tail.writeUInt32LE(offset, 10)
    directory.push(Buffer.concat([Buffer.from([0x50, 0x4b, 1, 2, 20, 0]), common, tail, nameBytes]))
    locals.push(local)
    offset += local.length
  }
  const central = Buffer.concat(directory)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(central.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, central, end])
}

export function reportDocx(report: Report): Buffer {
  const { xml: content, numbered } = body(report)
  return zip([
    ['[Content_Types].xml', CONTENT_TYPES],
    ['_rels/.rels', ROOT_RELS],
    ['word/_rels/document.xml.rels', DOC_RELS],
    ['word/document.xml', `${HEAD}<w:document ${NS}><w:body>${content}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1200" w:right="1440" w:bottom="1200" w:left="1440" w:header="600" w:footer="600" w:gutter="0"/></w:sectPr></w:body></w:document>`],
    ['word/styles.xml', STYLES],
    ['word/numbering.xml', numbering(numbered)]
  ])
}
