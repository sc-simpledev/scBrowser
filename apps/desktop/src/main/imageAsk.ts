import { nativeImage, type NativeImage, type Session, type WebContents } from 'electron'

const WORLD = 1020
/** Vision models read up to about this many pixels on the long side; more only costs more. */
const MAX_SIDE = 1568
const MAX_DOWNLOAD = 20_000_000
const FETCH_MS = 10_000

/** A picture as a JPEG data address, small enough to send to a model. Null if there's nothing to send. */
export function encodePicture(image: NativeImage): string | null {
  if (image.isEmpty()) return null
  const { width, height } = image.getSize()
  if (width < 2 || height < 2) return null
  const scale = Math.min(1, MAX_SIDE / Math.max(width, height))
  const sized = scale < 1 ? image.resize({ width: Math.round(width * scale), height: Math.round(height * scale), quality: 'good' }) : image
  return `data:image/jpeg;base64,${sized.toJPEG(85).toString('base64')}`
}

/** The image file itself, through the page's own session so it loads as the page saw it. */
async function fromAddress(session: Session, src: string): Promise<string | null> {
  try {
    const response = await session.fetch(src, { signal: AbortSignal.timeout(FETCH_MS) })
    if (!response.ok) return null
    const length = Number(response.headers.get('content-length') ?? 0)
    if (length > MAX_DOWNLOAD) return null
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.length > MAX_DOWNLOAD) return null
    // Electron reads PNG and JPEG; anything else comes from the screen instead.
    return encodePicture(nativeImage.createFromBuffer(bytes))
  } catch {
    return null
  }
}

/** What's on screen where the person right-clicked: any kind of picture, even one drawn on a canvas. */
async function fromScreen(contents: WebContents, x: number, y: number): Promise<string | null> {
  const zoom = contents.getZoomFactor() || 1
  const code = `(() => {
    const hit = document.elementFromPoint(${x / zoom}, ${y / zoom})
    const el = hit && (hit.closest('img, picture, svg, canvas, video') || hit)
    if (!el) return null
    const r = el.getBoundingClientRect()
    const left = Math.max(0, r.left), top = Math.max(0, r.top)
    const right = Math.min(innerWidth, r.right), bottom = Math.min(innerHeight, r.bottom)
    return right - left >= 4 && bottom - top >= 4 ? { x: left, y: top, width: right - left, height: bottom - top } : null
  })()`
  const rect = (await contents.executeJavaScriptInIsolatedWorld(WORLD, [{ code }]).catch(() => null)) as { x: number; y: number; width: number; height: number } | null
  if (!rect) return null
  const image = await contents
    .capturePage({ x: Math.round(rect.x * zoom), y: Math.round(rect.y * zoom), width: Math.round(rect.width * zoom), height: Math.round(rect.height * zoom) })
    .catch(() => null)
  return image ? encodePicture(image) : null
}

/** The picture at a point of the page, from its file where that can be read, else from the screen. */
export async function pictureAt(contents: WebContents, src: string, x: number, y: number): Promise<string | null> {
  // A picture written into the page itself needs no fetching.
  const inline = /^data:image\/(png|jpe?g);base64,/i.test(src) && src.length <= MAX_DOWNLOAD ? encodePicture(nativeImage.createFromDataURL(src)) : null
  const fetched = inline ?? (/^https?:/i.test(src) ? await fromAddress(contents.session, src) : null)
  return fetched ?? fromScreen(contents, x, y)
}
