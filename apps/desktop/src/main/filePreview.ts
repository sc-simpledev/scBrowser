import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { dialog, type BaseWindow, type BrowserWindow, type Event, type Session, type WebFrameMain } from 'electron'
import { previewKind, safeFileName } from '@scbrowser/shared'

/**
 * Files the assistant wrote run here, only in a frame on sc://assistant, never as an sc:// page.
 * Page text can steer what a model writes, so a file must have no way to send anything out:
 * - the scheme has no bridge, and the frame is sandboxed with an origin of its own;
 * - `PREVIEW_CSP` blocks every request it makes;
 * - sc://assistant's own policy only allows `sc-preview:` frames, so the frame can't navigate
 *   away (it fails with ERR_BLOCKED_BY_CSP, checked in e2e/aifiles.spec.ts);
 * - `guardPreviewFrames` is a second line behind that, in case the page's policy ever widens.
 */
export const PREVIEW_SCHEME = 'sc-preview'
export const MAX_PREVIEW_CHARS = 2_000_000
const KEPT = 24

export const PREVIEW_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' 'unsafe-eval'",
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'media-src data: blob:',
  'font-src data:',
  'worker-src blob:',
  'form-action none',
  'sandbox allow-scripts allow-modals'
].join('; ')

const previews = new Map<string, { name: string; content: string }>()

export const isPreviewUrl = (url: string) => url.toLowerCase().startsWith(`${PREVIEW_SCHEME}:`)

export function storePreview(name: string, content: string): string {
  const id = randomUUID()
  previews.set(id, { name: safeFileName(name), content })
  // Only the newest are kept, as each edit makes a new one.
  for (const old of [...previews.keys()].slice(0, Math.max(0, previews.size - KEPT))) previews.delete(old)
  return `${PREVIEW_SCHEME}://${id}/${encodeURIComponent(safeFileName(name))}`
}

const escapeScript = (code: string) => code.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--')

/** Runs a script on an empty page that shows what it logs. */
function scriptPage(code: string): string {
  return `<!doctype html><meta charset="utf-8"><style>
body{margin:0;padding:12px;font:12px/1.6 ui-monospace,monospace;background:#fff;color:#111}
.row{padding:3px 0;border-bottom:1px solid #eee;white-space:pre-wrap;overflow-wrap:anywhere}
.error{color:#c8473b}.warn{color:#9a6700}.empty{color:#8a8a8a}
</style><div id="out"><div class="row empty">Nothing logged yet.</div></div><script>
(() => {
  const out = document.getElementById('out')
  let first = true
  const text = (value) => { if (typeof value === 'string') return value; try { return JSON.stringify(value, null, 2) } catch { return String(value) } }
  const show = (kind, args) => {
    if (first) { out.textContent = ''; first = false }
    const row = document.createElement('div')
    row.className = 'row ' + kind
    row.textContent = args.map(text).join(' ')
    out.append(row)
  }
  for (const kind of ['log', 'info', 'warn', 'error']) {
    const original = console[kind]
    console[kind] = (...args) => { show(kind, args); original.apply(console, args) }
  }
  addEventListener('error', (event) => show('error', [event.message]))
  addEventListener('unhandledrejection', (event) => show('error', ['Unhandled: ' + text(event.reason && event.reason.message || event.reason)]))
})()
</script><script>
${escapeScript(code)}
</script>`
}

function previewResponse(url: URL): Response {
  const file = previews.get(url.host)
  if (!file) return new Response('This preview has expired. Open the file again.', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } })
  const kind = previewKind(file.name)
  const headers = { 'content-security-policy': PREVIEW_CSP, 'x-content-type-options': 'nosniff', 'cache-control': 'no-store' }
  if (kind === 'svg') return new Response(file.content, { headers: { ...headers, 'content-type': 'image/svg+xml; charset=utf-8' } })
  if (kind === 'script') return new Response(scriptPage(file.content), { headers: { ...headers, 'content-type': 'text/html; charset=utf-8' } })
  if (kind === 'html') return new Response(file.content, { headers: { ...headers, 'content-type': 'text/html; charset=utf-8' } })
  return new Response(file.content, { headers: { ...headers, 'content-type': 'text/plain; charset=utf-8' } })
}

export function handlePreviews(target: Session): void {
  target.protocol.handle(PREVIEW_SCHEME, (request) => previewResponse(new URL(request.url)))
}

const insidePreview = (frame: WebFrameMain | null | undefined): boolean => {
  for (let current = frame; current; current = current.parent) if (isPreviewUrl(current.url)) return true
  return false
}

/** A preview, or anything inside one, may only move to another preview. */
export function guardPreviewFrames(event: Event<{ url: string; isMainFrame: boolean; frame: WebFrameMain | null }>): void {
  if (!event.isMainFrame && insidePreview(event.frame) && !isPreviewUrl(event.url)) event.preventDefault()
}

export const isFileSave = (args: unknown[]): args is [string, string] =>
  args.length === 2 && typeof args[0] === 'string' && args[0].length <= 200 && typeof args[1] === 'string' && args[1].length <= MAX_PREVIEW_CHARS

export const isPreviewRequest = isFileSave

/** Asks where to save, keeping the name the assistant gave it. */
export async function saveFile(window: BaseWindow, name: string, content: string): Promise<boolean> {
  const result = await dialog.showSaveDialog(window as BrowserWindow, { defaultPath: safeFileName(name) })
  if (result.canceled || !result.filePath) return false
  await writeFile(result.filePath, content)
  return true
}
