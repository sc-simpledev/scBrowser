import { ArrowUpRight, Check, Copy, Download, Grid2x2, Highlighter, Pencil, Square, Undo2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react'
import { Button, cx } from '@scbrowser/ui'
import { api } from '../api'

/** What can be drawn on a screenshot. */
type Tool = 'box' | 'arrow' | 'pen' | 'highlight' | 'blur'

type Mark =
  | { tool: 'box' | 'arrow' | 'highlight' | 'blur'; colour: string; from: [number, number]; to: [number, number] }
  | { tool: 'pen'; colour: string; points: [number, number][] }

const TOOLS: { id: Tool; label: string; icon: typeof Square; key: string }[] = [
  { id: 'box', label: 'Box', icon: Square, key: 'b' },
  { id: 'arrow', label: 'Arrow', icon: ArrowUpRight, key: 'a' },
  { id: 'pen', label: 'Pen', icon: Pencil, key: 'p' },
  { id: 'highlight', label: 'Highlight', icon: Highlighter, key: 'h' },
  { id: 'blur', label: 'Blur', icon: Grid2x2, key: 'x' }
]

const COLOURS = ['#e5484d', '#f5a524', '#30a46c', '#0090ff', '#111111']

/** Pixelates a part of the picture, so words and faces under it can't be read back. */
function pixelate(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number) {
  const block = Math.max(8, Math.round(Math.min(context.canvas.width, context.canvas.height) / 90))
  const left = Math.max(0, Math.floor(Math.min(x, x + width)))
  const top = Math.max(0, Math.floor(Math.min(y, y + height)))
  const w = Math.min(context.canvas.width - left, Math.ceil(Math.abs(width)))
  const h = Math.min(context.canvas.height - top, Math.ceil(Math.abs(height)))
  if (w < 1 || h < 1) return
  const pixels = context.getImageData(left, top, w, h)
  for (let by = 0; by < h; by += block) {
    for (let bx = 0; bx < w; bx += block) {
      const sums = [0, 0, 0]
      let count = 0
      for (let py = by; py < Math.min(by + block, h); py++) {
        for (let px = bx; px < Math.min(bx + block, w); px++) {
          const at = (py * w + px) * 4
          sums[0]! += pixels.data[at]!
          sums[1]! += pixels.data[at + 1]!
          sums[2]! += pixels.data[at + 2]!
          count++
        }
      }
      context.fillStyle = `rgb(${sums.map((sum) => Math.round(sum / count)).join(',')})`
      context.fillRect(left + bx, top + by, Math.min(block, w - bx), Math.min(block, h - by))
    }
  }
}

function drawMark(context: CanvasRenderingContext2D, mark: Mark, scale: number) {
  context.save()
  context.strokeStyle = mark.colour
  context.fillStyle = mark.colour
  context.lineWidth = 4 * scale
  context.lineCap = 'round'
  context.lineJoin = 'round'
  if (mark.tool === 'pen') {
    context.beginPath()
    mark.points.forEach(([x, y], index) => (index === 0 ? context.moveTo(x, y) : context.lineTo(x, y)))
    context.stroke()
  } else {
    const [x1, y1] = mark.from
    const [x2, y2] = mark.to
    if (mark.tool === 'box') context.strokeRect(x1, y1, x2 - x1, y2 - y1)
    else if (mark.tool === 'highlight') {
      context.globalAlpha = 0.35
      context.fillRect(x1, y1, x2 - x1, y2 - y1)
    } else if (mark.tool === 'blur') pixelate(context, x1, y1, x2 - x1, y2 - y1)
    else {
      const angle = Math.atan2(y2 - y1, x2 - x1)
      const head = 18 * scale
      context.beginPath()
      context.moveTo(x1, y1)
      context.lineTo(x2, y2)
      context.stroke()
      context.beginPath()
      context.moveTo(x2, y2)
      context.lineTo(x2 - head * Math.cos(angle - Math.PI / 7), y2 - head * Math.sin(angle - Math.PI / 7))
      context.lineTo(x2 - head * Math.cos(angle + Math.PI / 7), y2 - head * Math.sin(angle + Math.PI / 7))
      context.closePath()
      context.fill()
    }
  }
  context.restore()
}

/**
 * sc://markup: the screenshot just taken, to draw boxes, arrows and highlights on, and blur what
 * shouldn't be seen, before copying or saving it. Nothing leaves the computer.
 */
export function MarkupPage() {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [picture, setPicture] = useState<HTMLImageElement | null>(null)
  const [title, setTitle] = useState('')
  const [missing, setMissing] = useState(false)
  const [tool, setTool] = useState<Tool>('box')
  const [colour, setColour] = useState(COLOURS[0]!)
  const [marks, setMarks] = useState<Mark[]>([])
  const drawing = useRef<Mark | null>(null)
  const [said, setSaid] = useState<string | null>(null)

  useEffect(() => {
    void api()
      .invoke('markup:image')
      .then((shot) => {
        if (!shot) return setMissing(true)
        setTitle(shot.title)
        document.title = `Mark up: ${shot.title || 'screenshot'}`
        const image = new Image()
        image.onload = () => setPicture(image)
        image.src = shot.dataUrl
      })
  }, [])

  const scale = picture ? Math.max(1, picture.naturalWidth / 1400) : 1
  const redraw = useCallback(
    (extra: Mark | null = null) => {
      const node = canvas.current
      const context = node?.getContext('2d', { willReadFrequently: true })
      if (!node || !context || !picture) return
      node.width = picture.naturalWidth
      node.height = picture.naturalHeight
      context.drawImage(picture, 0, 0)
      // Blurs first, so a box drawn over a blurred part stays sharp.
      const all = extra ? [...marks, extra] : marks
      for (const mark of all.filter((one) => one.tool === 'blur')) drawMark(context, mark, scale)
      for (const mark of all.filter((one) => one.tool !== 'blur')) drawMark(context, mark, scale)
    },
    [picture, marks, scale]
  )
  useEffect(() => redraw(), [redraw])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        setMarks((current) => current.slice(0, -1))
        return
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return
      const picked = TOOLS.find((one) => one.key === event.key.toLowerCase())
      if (picked) setTool(picked.id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const point = (event: PointerEvent<HTMLCanvasElement>): [number, number] => {
    const box = event.currentTarget.getBoundingClientRect()
    return [((event.clientX - box.left) / box.width) * event.currentTarget.width, ((event.clientY - box.top) / box.height) * event.currentTarget.height]
  }
  const down = (event: PointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    const at = point(event)
    drawing.current = tool === 'pen' ? { tool, colour, points: [at] } : { tool, colour: tool === 'highlight' && colour === '#111111' ? '#f5a524' : colour, from: at, to: at }
  }
  const move = (event: PointerEvent<HTMLCanvasElement>) => {
    const mark = drawing.current
    if (!mark) return
    const at = point(event)
    drawing.current = mark.tool === 'pen' ? { ...mark, points: [...mark.points, at] } : { ...mark, to: at }
    redraw(drawing.current)
  }
  const up = () => {
    const mark = drawing.current
    drawing.current = null
    if (!mark) return
    const tiny = mark.tool === 'pen' ? mark.points.length < 2 : Math.abs(mark.to[0] - mark.from[0]) < 3 && Math.abs(mark.to[1] - mark.from[1]) < 3
    if (!tiny) setMarks((current) => [...current, mark])
    else redraw()
  }

  const finished = () => canvas.current?.toDataURL('image/png') ?? ''
  const flash = (text: string) => {
    setSaid(text)
    setTimeout(() => setSaid(null), 2500)
  }
  const copy = () => void api().invoke('markup:copy', finished()).then((ok) => flash(ok ? 'Copied' : 'Couldn’t copy'))
  const save = () => void api().invoke('markup:save', finished(), title).then((path) => path && flash(`Saved to ${path.split(/[\\/]/).slice(-2).join('/')}`))

  if (missing)
    return (
      <main className="grid min-h-screen place-items-center bg-bg p-6 text-sm text-text-muted">
        <p>There’s no screenshot to mark up. Use “Screenshot and mark up” in the More menu, or Ctrl K.</p>
      </main>
    )
  return (
    <main className="flex h-screen flex-col bg-bg text-text">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
        <div role="toolbar" aria-label="Drawing tools" className="flex items-center gap-0.5">
          {TOOLS.map(({ id, label, icon: Icon, key }) => (
            <button
              key={id}
              type="button"
              aria-pressed={tool === id}
              title={`${label} (${key.toUpperCase()})`}
              onClick={() => setTool(id)}
              className={cx('flex h-8 items-center gap-1.5 rounded-md px-2 text-xs transition-colors', tool === id ? 'bg-accent-soft text-accent' : 'text-text-muted hover:bg-surface-hover hover:text-text')}
            >
              <Icon aria-hidden size={14} strokeWidth={1.75} />
              <span className="max-[720px]:sr-only">{label}</span>
            </button>
          ))}
        </div>
        <span aria-hidden className="h-5 w-px bg-border" />
        <div role="radiogroup" aria-label="Colour" className="flex items-center gap-1">
          {COLOURS.map((one) => (
            <button key={one} type="button" role="radio" aria-checked={colour === one} aria-label={`Colour ${one}`} onClick={() => setColour(one)} className={cx('size-5 rounded-full border-2 transition-transform', colour === one ? 'scale-110 border-text' : 'border-transparent')} style={{ background: one }} />
          ))}
        </div>
        <span aria-hidden className="h-5 w-px bg-border" />
        <Button variant="ghost" disabled={marks.length === 0} onClick={() => setMarks((current) => current.slice(0, -1))} title="Undo (Ctrl Z)">
          <Undo2 aria-hidden size={13} strokeWidth={1.75} />
          Undo
        </Button>
        <div className="ml-auto flex items-center gap-1.5">
          {said && (
            <span role="status" className="flex items-center gap-1 text-xs text-text-muted">
              <Check aria-hidden size={12} strokeWidth={2} />
              {said}
            </span>
          )}
          <Button onClick={copy} disabled={!picture}>
            <Copy aria-hidden size={13} strokeWidth={1.75} />
            Copy
          </Button>
          <Button variant="primary" onClick={save} disabled={!picture}>
            <Download aria-hidden size={13} strokeWidth={1.75} />
            Save
          </Button>
        </div>
      </header>
      <div className="grid min-h-0 flex-1 place-items-center overflow-auto bg-surface-hover p-4">
        <canvas
          ref={canvas}
          aria-label="Screenshot to draw on"
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          className="max-h-full max-w-full cursor-crosshair rounded-md shadow-3"
        />
      </div>
    </main>
  )
}
