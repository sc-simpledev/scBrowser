// Runs in its own short-lived utility process: PDFs are untrusted files, and a bug in
// the parser must never run inside the main process, which holds API keys.
import 'pdfjs-dist/legacy/build/pdf.worker.mjs'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

const MAX_PAGES = 1000
const MAX_CHARS = 200_000

interface TextItem {
  str?: string
  hasEOL?: boolean
}

async function read(data: Uint8Array) {
  const document = await getDocument({
    data,
    useSystemFonts: false,
    disableFontFace: true,
    verbosity: 0
  }).promise
  const pages: string[] = []
  let length = 0
  const lastPage = Math.min(document.numPages, MAX_PAGES)
  for (let number = 1; number <= lastPage && length < MAX_CHARS; number++) {
    const page = await document.getPage(number)
    const content = await page.getTextContent()
    const text = (content.items as TextItem[]).map((item) => `${item.str ?? ''}${item.hasEOL ? '\n' : ''}`).join('').trim()
    if (text) {
      pages.push(`[Page ${number}]\n${text}`)
      length += text.length
    }
    page.cleanup()
  }
  const { info } = (await document.getMetadata().catch(() => ({ info: {} }))) as { info: { Title?: unknown } }
  return { title: typeof info.Title === 'string' ? info.Title : '', text: pages.join('\n\n') }
}

process.parentPort.once('message', ({ data }: { data: Uint8Array }) => {
  read(new Uint8Array(data))
    .then((result) => process.parentPort.postMessage({ ok: true, ...result }))
    .catch(() => process.parentPort.postMessage({ ok: false }))
})
