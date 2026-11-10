import type { Report, ReportBlock, ReportThemeId } from '@scbrowser/shared'
import { xml, zip } from './reportDocx'

/**
 * A report as a slide deck. Each level-two heading starts a slide, so a report written as
 * "Slide 1", "Slide 2" comes out as those slides. Like the Word file, it's rebuilt from the
 * report's blocks, so only plain text reaches it, and the zip is written here with no library.
 */

const WIDTH = 12_192_000
const HEIGHT = 6_858_000
const MARGIN = 640_080
/** Roughly what fits in the body at 18 pt before a slide carries on to the next. */
const LINES_PER_SLIDE = 11
const CHARS_PER_LINE = 88

interface Palette {
  accent: string
  text: string
  muted: string
  surface: string
  soft: string
  font: string
}

/** Close to each design's look on screen, in the colours and fonts every copy of PowerPoint has. */
const PALETTES: Record<ReportThemeId, Palette> = {
  clean: { accent: '2A8C99', text: '1F2328', muted: '5F6670', surface: 'FFFFFF', soft: 'E6F2F4', font: 'Calibri' },
  editorial: { accent: '8A5A2B', text: '22201C', muted: '6B655C', surface: 'FBF8F3', soft: 'F1E8DC', font: 'Georgia' },
  brief: { accent: '2F5DA8', text: '1C2230', muted: '5A6272', surface: 'FFFFFF', soft: 'E7EDF8', font: 'Calibri' },
  modern: { accent: '6246EA', text: '15131F', muted: '5C5870', surface: 'FFFFFF', soft: 'EEEBFD', font: 'Segoe UI' },
  magazine: { accent: 'C2410C', text: '1C1917', muted: '6B625C', surface: 'FFFBF7', soft: 'FCE9DC', font: 'Georgia' },
  academic: { accent: '1E3A5F', text: '1A1A1A', muted: '555555', surface: 'FFFFFF', soft: 'E8EDF3', font: 'Times New Roman' },
  notebook: { accent: '2A8C99', text: '23262B', muted: '5F6670', surface: 'FFFDF6', soft: 'E3F1F2', font: 'Segoe UI' }
}

interface Line {
  text: string
  /** A bold lead-in before the rest of the line, like a card's title. */
  lead?: string
  bullet?: boolean
  numbered?: boolean
  level?: 0 | 1
  bold?: boolean
  italic?: boolean
  accent?: boolean
}

export type Slide =
  | { kind: 'title'; title: string; subtitle: string; label: string }
  | { kind: 'text'; title: string; lines: Line[] }
  | { kind: 'table'; title: string; headers: string[]; rows: string[][] }
  | { kind: 'stats'; title: string; items: { value: string; label: string }[] }

const weight = (line: Line) => Math.max(1, Math.ceil(((line.lead?.length ?? 0) + line.text.length + 2) / CHARS_PER_LINE))

function linesOf(block: ReportBlock): Line[] {
  switch (block.type) {
    case 'heading':
      return [{ text: block.text, bold: true }]
    case 'paragraph':
      return [{ text: block.text }]
    case 'quote':
      return [{ text: `“${block.text}”`, italic: true }]
    case 'callout':
      return [{ text: block.text, accent: true, bold: true }]
    case 'list':
      return block.items.map((text) => ({ text, bullet: !block.ordered, numbered: block.ordered }))
    case 'timeline':
      return block.items.map((item) => ({ lead: item.when, text: item.text, bullet: true }))
    case 'cards':
      return block.items.map((item) => ({ lead: item.title, text: item.text, bullet: true }))
    case 'steps':
      return block.items.map((item) => ({ lead: item.title, text: item.text, numbered: true }))
    case 'proscons':
      return [
        ...(block.pros.length ? [{ text: 'Pros', bold: true }, ...block.pros.map((text) => ({ text, bullet: true, level: 1 as const }))] : []),
        ...(block.cons.length ? [{ text: 'Cons', bold: true }, ...block.cons.map((text) => ({ text, bullet: true, level: 1 as const }))] : [])
      ]
    case 'quiz':
      return block.items.flatMap((item) => [
        { text: item.question, numbered: true },
        { text: item.answer, bullet: true, level: 1 as const, italic: true }
      ])
    case 'stats':
    case 'table':
    case 'spacer':
    case 'divider':
      return []
  }
}

/** Splits a report into slides, carrying long sections on to more slides rather than shrinking them. */
export function reportSlides(report: Report): Slide[] {
  const slides: Slide[] = [{ kind: 'title', title: report.title, subtitle: report.summary, label: report.kind ?? '' }]
  let title = 'Overview'
  let lines: Line[] = []
  let used = 0
  let part = 0
  const flush = () => {
    if (lines.length === 0) return
    slides.push({ kind: 'text', title: part > 0 ? `${title} (continued)` : title, lines })
    lines = []
    used = 0
    part++
  }
  for (const block of report.blocks) {
    if (block.type === 'heading' && block.level === 2) {
      flush()
      title = block.text
      part = 0
      continue
    }
    if (block.type === 'table') {
      flush()
      // Big tables go over several slides, with the header on each.
      for (let start = 0; start < Math.max(1, block.rows.length); start += 8) {
        slides.push({ kind: 'table', title: part > 0 ? `${title} (continued)` : title, headers: block.headers, rows: block.rows.slice(start, start + 8) })
        part++
      }
      continue
    }
    if (block.type === 'stats') {
      flush()
      slides.push({ kind: 'stats', title: part > 0 ? `${title} (continued)` : title, items: block.items.slice(0, 4) })
      part++
      continue
    }
    for (const line of linesOf(block)) {
      if (used + weight(line) > LINES_PER_SLIDE && lines.length > 0) flush()
      lines.push(line)
      used += weight(line)
    }
  }
  flush()
  if (report.sources?.length) {
    slides.push({ kind: 'text', title: 'Sources', lines: report.sources.map((source) => ({ lead: `${source.n}.`, text: `${source.title ? `${source.title}, ` : ''}${source.url}` })) })
  }
  return slides
}

const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"'
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const pt = (size: number) => Math.round(size * 100)

function run(text: string, palette: Palette, { size, bold, italic, color }: { size: number; bold?: boolean; italic?: boolean; color?: string }): string {
  return `<a:r><a:rPr lang="en-US" sz="${pt(size)}"${bold ? ' b="1"' : ''}${italic ? ' i="1"' : ''} dirty="0"><a:solidFill><a:srgbClr val="${color ?? palette.text}"/></a:solidFill><a:latin typeface="${xml(palette.font)}"/><a:cs typeface="${xml(palette.font)}"/></a:rPr><a:t>${xml(text)}</a:t></a:r>`
}

function paragraph(line: Line, palette: Palette, size: number): string {
  const level = line.level ?? 0
  const indent = line.bullet || line.numbered ? ` marL="${(level + 1) * 342_900}" indent="-285750"` : level ? ` marL="${level * 342_900}"` : ''
  const marker = line.numbered
    ? `<a:buClr><a:srgbClr val="${palette.accent}"/></a:buClr><a:buFont typeface="+mj-lt"/><a:buAutoNum type="arabicPeriod"/>`
    : line.bullet
      ? `<a:buClr><a:srgbClr val="${palette.accent}"/></a:buClr><a:buFont typeface="Arial"/><a:buChar char="${level ? '–' : '•'}"/>`
      : '<a:buNone/>'
  const textSize = level ? size - 2 : size
  const color = line.accent ? palette.accent : line.italic && level ? palette.muted : undefined
  const lead = line.lead ? run(`${line.lead}  `, palette, { size: textSize, bold: true }) : ''
  return `<a:p><a:pPr${indent}><a:spcBef><a:spcPts val="${level ? 200 : 600}"/></a:spcBef>${marker}</a:pPr>${lead}${run(line.text, palette, { size: textSize, bold: line.bold, italic: line.italic, color })}</a:p>`
}

let shapeId = 1
const box = (name: string, x: number, y: number, w: number, h: number, body: string, { anchor = 't', fill }: { anchor?: 't' | 'ctr' | 'b'; fill?: string } = {}) =>
  `<p:sp><p:nvSpPr><p:cNvPr id="${++shapeId}" name="${name} ${shapeId}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${fill ? `<a:solidFill><a:srgbClr val="${fill}"/></a:solidFill>` : '<a:noFill/>'}</p:spPr><p:txBody><a:bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0" anchor="${anchor}"><a:normAutofit/></a:bodyPr><a:lstStyle/>${body}</p:txBody></p:sp>`

const bar = (x: number, y: number, w: number, h: number, color: string) =>
  `<p:sp><p:nvSpPr><p:cNvPr id="${++shapeId}" name="Bar ${shapeId}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr></p:sp>`

const titleOf = (text: string, palette: Palette) =>
  bar(MARGIN, 520_000, 420_000, 54_000, palette.accent) +
  box('Title', MARGIN, 640_000, WIDTH - MARGIN * 2, 820_000, `<a:p>${run(text, palette, { size: 30, bold: true })}</a:p>`, { anchor: 'b' })

function tableShape(slide: Extract<Slide, { kind: 'table' }>, palette: Palette): string {
  const columns = Math.max(1, slide.headers.length, ...slide.rows.map((row) => row.length))
  const width = WIDTH - MARGIN * 2
  const column = Math.floor(width / columns)
  const rowHeight = 480_000
  const cell = (text: string, header: boolean, shaded: boolean) =>
    `<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p>${run(text, palette, { size: header ? 14 : 13, bold: header, color: header ? palette.surface : palette.text })}</a:p></a:txBody><a:tcPr marL="91440" marR="91440" marT="45720" marB="45720" anchor="ctr">${['lnL', 'lnR', 'lnT', 'lnB'].map((side) => `<a:${side} w="6350"><a:solidFill><a:srgbClr val="D9DDE1"/></a:solidFill></a:${side}>`).join('')}<a:solidFill><a:srgbClr val="${header ? palette.accent : shaded ? palette.soft : palette.surface}"/></a:solidFill></a:tcPr></a:tc>`
  const row = (cells: string[], header: boolean, index: number) => `<a:tr h="${rowHeight}">${Array.from({ length: columns }, (_, i) => cell(cells[i] ?? '', header, index % 2 === 1)).join('')}</a:tr>`
  const height = rowHeight * (slide.rows.length + 1)
  return `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${++shapeId}" name="Table ${shapeId}"/><p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="${MARGIN}" y="1700000"/><a:ext cx="${column * columns}" cy="${height}"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="1" bandRow="1"/><a:tblGrid>${`<a:gridCol w="${column}"/>`.repeat(columns)}</a:tblGrid>${row(slide.headers, true, 0)}${slide.rows.map((cells, index) => row(cells, false, index)).join('')}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`
}

function statsShapes(slide: Extract<Slide, { kind: 'stats' }>, palette: Palette): string {
  const gap = 228_600
  const count = Math.max(1, slide.items.length)
  const width = Math.floor((WIDTH - MARGIN * 2 - gap * (count - 1)) / count)
  return slide.items
    .map((item, index) => {
      const x = MARGIN + index * (width + gap)
      const body = `<a:p>${run(item.value, palette, { size: 44, bold: true, color: palette.accent })}</a:p><a:p><a:pPr><a:spcBef><a:spcPts val="600"/></a:spcBef></a:pPr>${run(item.label, palette, { size: 16, color: palette.muted })}</a:p>`
      return bar(x, 2_000_000, width, 2_300_000, palette.soft) + box('Figure', x + 228_600, 2_200_000, width - 457_200, 1_900_000, body, { anchor: 'ctr' })
    })
    .join('')
}

function slideXml(slide: Slide, palette: Palette, number: number, total: number): string {
  shapeId = 1
  let shapes: string
  if (slide.kind === 'title') {
    shapes =
      bar(0, 0, 228_600, HEIGHT, palette.accent) +
      (slide.label ? box('Kind', MARGIN * 2, 1_900_000, WIDTH - MARGIN * 4, 400_000, `<a:p>${run(slide.label.toUpperCase(), palette, { size: 14, bold: true, color: palette.accent })}</a:p>`, { anchor: 'b' }) : '') +
      box('Title', MARGIN * 2, 2_350_000, WIDTH - MARGIN * 4, 1_600_000, `<a:p>${run(slide.title, palette, { size: 44, bold: true })}</a:p>`, { anchor: 'ctr' }) +
      (slide.subtitle ? box('Subtitle', MARGIN * 2, 4_050_000, WIDTH - MARGIN * 4, 1_100_000, `<a:p>${run(slide.subtitle, palette, { size: 20, color: palette.muted })}</a:p>`) : '')
  } else {
    const body =
      slide.kind === 'text'
        ? box('Body', MARGIN, 1_700_000, WIDTH - MARGIN * 2, HEIGHT - 1_700_000 - 700_000, slide.lines.map((line) => paragraph(line, palette, slide.lines.reduce((sum, line) => sum + weight(line), 0) <= 4 ? 24 : 18)).join(''))
        : slide.kind === 'table'
          ? tableShape(slide, palette)
          : statsShapes(slide, palette)
    const footer = box('Page', WIDTH - MARGIN - 1_200_000, HEIGHT - 500_000, 1_200_000, 260_000, `<a:p><a:pPr algn="r"/>${run(`${number} / ${total}`, palette, { size: 10, color: palette.muted })}</a:p>`)
    shapes = titleOf(slide.title, palette) + body + footer
  }
  return `${HEAD}<p:sld ${NS}><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="${palette.surface}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${shapes}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`
}

const THEME = (palette: Palette) => {
  const scheme = `<a:clrScheme name="scTerra"><a:dk1><a:srgbClr val="${palette.text}"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2>${['accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6'].map((name) => `<a:${name}><a:srgbClr val="${palette.accent}"/></a:${name}>`).join('')}<a:hlink><a:srgbClr val="${palette.accent}"/></a:hlink><a:folHlink><a:srgbClr val="${palette.muted}"/></a:folHlink></a:clrScheme>`
  const fonts = `<a:fontScheme name="scTerra"><a:majorFont><a:latin typeface="${xml(palette.font)}"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="${xml(palette.font)}"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>`
  const fill = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'
  const line = '<a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>'
  const effect = '<a:effectStyle><a:effectLst/></a:effectStyle>'
  const format = `<a:fmtScheme name="scTerra"><a:fillStyleLst>${fill.repeat(3)}</a:fillStyleLst><a:lnStyleLst>${line.repeat(3)}</a:lnStyleLst><a:effectStyleLst>${effect.repeat(3)}</a:effectStyleLst><a:bgFillStyleLst>${fill.repeat(3)}</a:bgFillStyleLst></a:fmtScheme>`
  return `${HEAD}<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="scTerra"><a:themeElements>${scheme}${fonts}${format}</a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>`
}

const EMPTY_TREE = '<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree>'
const MASTER = `${HEAD}<p:sldMaster ${NS}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg>${EMPTY_TREE}</p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle><a:lvl1pPr><a:defRPr sz="3200"/></a:lvl1pPr></p:titleStyle><p:bodyStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:bodyStyle><p:otherStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>`
const LAYOUT = `${HEAD}<p:sldLayout ${NS} type="blank" preserve="1"><p:cSld name="Blank">${EMPTY_TREE}</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`
const rels = (items: [string, string][]) =>
  `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items.map(([type, target], index) => `<Relationship Id="rId${index + 1}" Type="${REL}/${type}" Target="${target}"/>`).join('')}</Relationships>`

/** A slide as plain text, for the model writing its speaker notes. */
export function slideText(slide: Slide): string {
  switch (slide.kind) {
    case 'title':
      return [slide.label, slide.title, slide.subtitle].filter(Boolean).join('\n')
    case 'text':
      return [slide.title, ...slide.lines.map((line) => `${line.bullet || line.numbered ? '- ' : ''}${line.lead ? `${line.lead}: ` : ''}${line.text}`)].join('\n')
    case 'table':
      return [slide.title, slide.headers.join(' | '), ...slide.rows.map((row) => row.join(' | '))].join('\n')
    case 'stats':
      return [slide.title, ...slide.items.map((item) => `${item.value}: ${item.label}`)].join('\n')
  }
}

const notesBody = (text: string) =>
  text
    .split(/\n+/)
    .filter((line) => line.trim())
    .map((line) => `<a:p><a:r><a:rPr lang="en-US" sz="1200" dirty="0"/><a:t>${xml(line.trim())}</a:t></a:r></a:p>`)
    .join('') || '<a:p><a:endParaRPr lang="en-US"/></a:p>'

const notesPlaceholder = (body: string) =>
  `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Notes Placeholder 1"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="685800" y="4400550"/><a:ext cx="5486400" cy="3600450"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/>${body}</p:txBody></p:sp>`
const NOTES_MASTER = `${HEAD}<p:notesMaster ${NS}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${notesPlaceholder('<a:p><a:endParaRPr lang="en-US"/></a:p>')}</p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:notesStyle><a:lvl1pPr><a:defRPr sz="1200"/></a:lvl1pPr></p:notesStyle></p:notesMaster>`
const notesSlide = (text: string) =>
  `${HEAD}<p:notes ${NS}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${notesPlaceholder(notesBody(text))}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>`

/** `notes`, when given, are the speaker notes for each slide in order, shown under the slide in PowerPoint. */
export function reportPptx(report: Report, notes?: string[]): Buffer {
  const palette = PALETTES[report.theme] ?? PALETTES.clean
  const slides = reportSlides(report)
  const total = slides.length
  const withNotes = !!notes?.some((note) => note.trim())
  const slideTypes = slides.map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('')
  const notesTypes = withNotes
    ? `<Override PartName="/ppt/notesMasters/notesMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml"/><Override PartName="/ppt/theme/theme2.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>${slides.map((_, i) => `<Override PartName="/ppt/notesSlides/notesSlide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/>`).join('')}`
    : ''
  const types = `${HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>${slideTypes}${notesTypes}</Types>`
  // Slides take rId3 onwards; the notes master comes after them.
  const notesMasterId = `rId${slides.length + 3}`
  const presentation = `${HEAD}<p:presentation ${NS} saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>${withNotes ? `<p:notesMasterIdLst><p:notesMasterId r:id="${notesMasterId}"/></p:notesMasterIdLst>` : ''}<p:sldIdLst>${slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 3}"/>`).join('')}</p:sldIdLst><p:sldSz cx="${WIDTH}" cy="${HEIGHT}"/><p:notesSz cx="6858000" cy="9144000"/><p:defaultTextStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:defaultTextStyle></p:presentation>`
  const core = `${HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${xml(report.title)}</dc:title><dc:creator>scTerra</dc:creator></cp:coreProperties>`
  return zip([
    ['[Content_Types].xml', types],
    ['_rels/.rels', `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="ppt/presentation.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`],
    ['docProps/core.xml', core],
    ['ppt/presentation.xml', presentation],
    ['ppt/_rels/presentation.xml.rels', rels([['slideMaster', 'slideMasters/slideMaster1.xml'], ['theme', 'theme/theme1.xml'], ...slides.map((_, i) => ['slide', `slides/slide${i + 1}.xml`] as [string, string]), ...(withNotes ? [['notesMaster', 'notesMasters/notesMaster1.xml'] as [string, string]] : [])])],
    ['ppt/slideMasters/slideMaster1.xml', MASTER],
    ['ppt/slideMasters/_rels/slideMaster1.xml.rels', rels([['slideLayout', '../slideLayouts/slideLayout1.xml'], ['theme', '../theme/theme1.xml']])],
    ['ppt/slideLayouts/slideLayout1.xml', LAYOUT],
    ['ppt/slideLayouts/_rels/slideLayout1.xml.rels', rels([['slideMaster', '../slideMasters/slideMaster1.xml']])],
    ['ppt/theme/theme1.xml', THEME(palette)],
    ...(withNotes
      ? ([
          ['ppt/notesMasters/notesMaster1.xml', NOTES_MASTER],
          ['ppt/notesMasters/_rels/notesMaster1.xml.rels', rels([['theme', '../theme/theme2.xml']])],
          ['ppt/theme/theme2.xml', THEME(palette)]
        ] as [string, string][])
      : []),
    ...slides.flatMap((slide, i): [string, string][] => [
      [`ppt/slides/slide${i + 1}.xml`, slideXml(slide, palette, i + 1, total)],
      [`ppt/slides/_rels/slide${i + 1}.xml.rels`, rels([['slideLayout', '../slideLayouts/slideLayout1.xml'], ...(withNotes ? [['notesSlide', `../notesSlides/notesSlide${i + 1}.xml`] as [string, string]] : [])])],
      ...(withNotes
        ? ([
            [`ppt/notesSlides/notesSlide${i + 1}.xml`, notesSlide(notes![i] ?? '')],
            [`ppt/notesSlides/_rels/notesSlide${i + 1}.xml.rels`, rels([['notesMaster', '../notesMasters/notesMaster1.xml'], ['slide', `../slides/slide${i + 1}.xml`]])]
          ] as [string, string][])
        : [])
    ])
  ])
}
