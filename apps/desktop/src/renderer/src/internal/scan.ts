import type { PDFDocumentProxy } from 'pdfjs-dist'
import { createWorker } from 'tesseract.js'

/** Long documents would take minutes, and the first pages are usually what's asked about. */
const MAX_PAGES = 30
/** Enough pixels for small print without using too much memory. */
const RENDER_SCALE = 2

/** A recognised word, placed as fractions of the page. */
export interface ScanWord {
  text: string
  x: number
  y: number
  height: number
}

interface Word {
  text: string
  bbox: { x0: number; y0: number; y1: number }
}

/** Everything runs in this sandboxed page from files inside the app, so no scan leaves the computer. */
export async function readScan(doc: PDFDocumentProxy, onPage: (page: number, total: number) => void) {
  const base = `${location.origin}/ocr/`
  const worker = await createWorker('eng', 1, { workerPath: `${base}worker.min.js`, corePath: base, langPath: base, workerBlobURL: false, gzip: true, cacheMethod: 'none' })
  const total = Math.min(doc.numPages, MAX_PAGES)
  const pages: string[] = []
  const words: Record<number, ScanWord[]> = {}
  try {
    for (let number = 1; number <= total; number++) {
      onPage(number, total)
      const page = await doc.getPage(number)
      const viewport = page.getViewport({ scale: RENDER_SCALE })
      const canvas = document.createElement('canvas')
      canvas.width = Math.floor(viewport.width)
      canvas.height = Math.floor(viewport.height)
      await page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport }).promise
      const { data } = await worker.recognize(canvas, {}, { text: true, blocks: true })
      const found = (data.blocks ?? []).flatMap((block) => block.paragraphs.flatMap((paragraph) => paragraph.lines.flatMap((line) => line.words as Word[])))
      words[number] = found.map(({ text, bbox }) => ({ text, x: bbox.x0 / canvas.width, y: bbox.y0 / canvas.height, height: (bbox.y1 - bbox.y0) / canvas.height }))
      if (data.text.trim()) pages.push(`[Page ${number}]\n${data.text.trim()}`)
      page.cleanup()
    }
  } finally {
    await worker.terminate()
  }
  return { text: pages.join('\n\n'), words }
}
