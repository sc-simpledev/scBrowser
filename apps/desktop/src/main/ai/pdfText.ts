import { utilityProcess, type WebContents } from 'electron'
import pdfWorkerPath from './pdfWorker?modulePath'

const MAX_BYTES = 64 * 1024 * 1024
const TIMEOUT_MS = 30_000

export interface PdfText {
  title: string
  text: string
}

/** Parses PDF bytes in a separate process, which is killed if it takes too long. */
function parse(data: Uint8Array): Promise<PdfText | null> {
  return new Promise((resolve) => {
    const child = utilityProcess.fork(pdfWorkerPath, [], { serviceName: 'scTerra PDF reader' })
    const finish = (result: PdfText | null) => {
      clearTimeout(timer)
      resolve(result)
      child.kill()
    }
    const timer = setTimeout(() => finish(null), TIMEOUT_MS)
    child.once('spawn', () => child.postMessage(data))
    child.once('message', (message: { ok: boolean; title?: string; text?: string }) =>
      finish(message.ok ? { title: message.title ?? '', text: message.text ?? '' } : null)
    )
    child.once('exit', () => finish(null))
  })
}

/** Downloads the tab's PDF with its own cookies, so signed-in documents work too. */
export async function readPdf(contents: WebContents, url: string): Promise<PdfText | null> {
  const response = await contents.session.fetch(url)
  if (!response.ok) return null
  if (Number(response.headers.get('content-length')) > MAX_BYTES) return null
  const bytes = new Uint8Array(await response.arrayBuffer())
  return bytes.length > MAX_BYTES ? null : parse(bytes)
}
