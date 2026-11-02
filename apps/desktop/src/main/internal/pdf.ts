import type { Session, WebContents } from 'electron'
import { effectiveUrl, PDF_PAGE_URL } from '@scbrowser/shared'

const MAX_BYTES = 300 * 1024 * 1024

/** PDFs the person chose to open in Chromium's own viewer. */
const basic = new Set<string>()

export const allowBasicPdf = (url: string) => void basic.add(url)
export const isBasicPdf = (url: string) => basic.has(url)

export const pdfPageUrl = (url: string) => `${PDF_PAGE_URL}?${new URLSearchParams({ url })}`

type Headers = Record<string, string[]> | undefined

const header = (headers: Headers, name: string) =>
  Object.entries(headers ?? {}).find(([key]) => key.toLowerCase() === name)?.[1]?.[0]?.toLowerCase() ?? ''

/** Files sent as attachments are downloads, not pages. */
export function isPdfResponse(url: string, headers: Headers): boolean {
  if (basic.has(url) || header(headers, 'content-disposition').startsWith('attachment')) return false
  return header(headers, 'content-type').split(';')[0]?.trim() === 'application/pdf'
}

/** The address of the PDF this viewer tab is showing. It comes from the tab, never the page's say-so. */
export function pdfSource(contents: WebContents): string | null {
  const page = contents.getURL()
  if (!page.startsWith(PDF_PAGE_URL)) return null
  const url = effectiveUrl(page)
  return /^(https?|file):/i.test(url) ? url : null
}

/** Fetched with the tab's own cookies, so signed-in documents work. */
export async function fetchPdf(session: Session, url: string): Promise<Uint8Array | null> {
  const response = await session.fetch(url).catch(() => null)
  if (!response?.ok || Number(response.headers.get('content-length')) > MAX_BYTES) return null
  const bytes = new Uint8Array(await response.arrayBuffer())
  return bytes.length > MAX_BYTES ? null : bytes
}
