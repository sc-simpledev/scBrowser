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

/**
 * Lets the person drag a box over the page, in its isolated world, for "Ask AI about part of the
 * page". The box's place in the page's own pixels, or null if they pressed Escape. The dimming
 * is gone again before this returns, so a capture right after shows the page as it is.
 */
const PICK_SCRIPT = `new Promise((done) => {
  const host = document.createElement('div')
  host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;cursor:crosshair'
  const shadow = host.attachShadow({ mode: 'closed' })
  shadow.innerHTML = '<style>.dim{position:fixed;inset:0;background:rgba(0,0,0,.28)}.box{position:fixed;display:none;border:1.5px solid #fff;box-shadow:0 0 0 9999px rgba(0,0,0,.38);border-radius:3px}.tip{position:fixed;left:50%;top:16px;transform:translateX(-50%);padding:6px 10px;border-radius:6px;background:#171717;color:#fafafa;font:500 12px/1.3 system-ui,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.3)}</style><div class="dim"></div><div class="box"></div><div class="tip">Drag over what to ask about · Esc to cancel</div>'
  const dim = shadow.querySelector('.dim'), box = shadow.querySelector('.box'), tip = shadow.querySelector('.tip')
  let start = null
  const rect = (event) => ({ x: Math.min(start.x, event.clientX), y: Math.min(start.y, event.clientY), width: Math.abs(event.clientX - start.x), height: Math.abs(event.clientY - start.y) })
  const finish = (value) => {
    removeEventListener('keydown', onKey, true)
    host.remove()
    // Two frames, so the page is painted without the dimming before it's captured.
    requestAnimationFrame(() => requestAnimationFrame(() => done(value)))
  }
  const onKey = (event) => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopImmediatePropagation()
    finish(null)
  }
  host.addEventListener('mousedown', (event) => {
    if (event.button !== 0) return finish(null)
    event.preventDefault()
    start = { x: event.clientX, y: event.clientY }
    dim.style.display = 'none'
    tip.style.display = 'none'
    box.style.display = 'block'
    Object.assign(box.style, { left: start.x + 'px', top: start.y + 'px', width: '0px', height: '0px' })
  })
  host.addEventListener('mousemove', (event) => {
    if (!start) return
    const r = rect(event)
    Object.assign(box.style, { left: r.x + 'px', top: r.y + 'px', width: r.width + 'px', height: r.height + 'px' })
  })
  host.addEventListener('mouseup', (event) => {
    if (!start) return
    const r = rect(event)
    finish(r.width >= 8 && r.height >= 8 ? r : null)
  })
  addEventListener('keydown', onKey, true)
  ;(document.documentElement || document.body).append(host)
})`

/** A part of the page the person drags out, as a picture for the assistant. Null when they cancelled. */
export async function pictureOfRegion(contents: WebContents): Promise<string | null> {
  contents.focus()
  const rect = (await contents.executeJavaScriptInIsolatedWorld(WORLD, [{ code: PICK_SCRIPT }], true).catch(() => null)) as { x: number; y: number; width: number; height: number } | null
  if (!rect || contents.isDestroyed()) return null
  const zoom = contents.getZoomFactor() || 1
  const image = await contents.capturePage({ x: Math.round(rect.x * zoom), y: Math.round(rect.y * zoom), width: Math.round(rect.width * zoom), height: Math.round(rect.height * zoom) }).catch(() => null)
  return image ? encodePicture(image) : null
}
