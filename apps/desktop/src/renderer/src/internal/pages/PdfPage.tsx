import { ChevronLeft, ChevronRight, Download, FileText, Maximize2, Minus, PanelLeft, Plus, Printer, RotateCw, ScanText } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import 'pdfjs-dist/web/pdf_viewer.css'
import { Button, cx, IconButton, Input, TooltipProvider } from '@scbrowser/ui'
import { effectiveUrl } from '@scbrowser/shared'
import { api } from '../api'
import { readScan, type ScanWord } from '../scan'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

const ZOOM_STEP = 1.2
const MIN_SCALE = 0.25
const MAX_SCALE = 5
const PAGE_GAP = 12
/** Space kept around the page when fitting it to the window. */
const FIT_MARGIN = 48
const THUMB_WIDTH = 120
const NO_WORDS: ScanWord[] = []

const fileName = (url: string) => {
  const name = URL.canParse(url) ? new URL(url).pathname.split('/').pop() : ''
  return decodeURIComponent(name || 'Document.pdf')
}

interface PageProps {
  doc: PDFDocumentProxy
  number: number
  scale: number
  rotation: number
  size: { width: number; height: number }
  renderAll: boolean
  observer: IntersectionObserver | null
  /** Words recognised in a scan, which make it searchable and selectable. */
  words: ScanWord[]
}

/** Draws only when near the screen, so long documents stay quick. */
function Page({ doc, number, scale, rotation, size, renderAll, observer, words }: PageProps) {
  const holder = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const textLayer = useRef<HTMLDivElement>(null)
  const [near, setNear] = useState(number === 1)

  useEffect(() => {
    const element = holder.current
    if (!element || !observer) return
    const onNear = () => setNear(true)
    element.addEventListener('sc-near', onNear)
    observer.observe(element)
    return () => {
      element.removeEventListener('sc-near', onNear)
      observer.unobserve(element)
    }
  }, [observer])

  useEffect(() => {
    if (!near && !renderAll) return
    let cancelled = false
    let task: ReturnType<PDFPageProxy['render']> | null = null
    void doc.getPage(number).then(async (page) => {
      if (cancelled || !canvas.current || !textLayer.current) return
      const viewport = page.getViewport({ scale, rotation: (page.rotate + rotation) % 360 })
      const ratio = window.devicePixelRatio || 1
      const target = canvas.current
      target.width = Math.floor(viewport.width * ratio)
      target.height = Math.floor(viewport.height * ratio)
      task = page.render({ canvas: target, canvasContext: target.getContext('2d')!, viewport, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] })
      await task.promise.catch(() => undefined)
      if (cancelled) return
      // Selectable text, which also lets Ctrl F find words in the page.
      const layer = textLayer.current
      if (!layer) return
      layer.replaceChildren()
      layer.style.setProperty('--scale-factor', String(scale))
      await new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container: layer, viewport }).render().catch(() => undefined)
    })
    return () => {
      cancelled = true
      task?.cancel()
    }
  }, [doc, number, scale, rotation, near, renderAll])

  const turned = rotation % 180 !== 0
  const width = (turned ? size.height : size.width) * scale
  const height = (turned ? size.width : size.height) * scale
  return (
    <div ref={holder} data-page={number} className="sc-pdf-page relative mx-auto bg-[white] shadow-1" style={{ width, height, marginBottom: PAGE_GAP }}>
      <canvas ref={canvas} aria-label={`Page ${number}`} className="block size-full" />
      <div ref={textLayer} className="textLayer" />
      {rotation === 0 &&
        words.map((word, index) => (
          <span
            key={index}
            className="absolute leading-none whitespace-pre text-transparent"
            style={{ left: `${word.x * 100}%`, top: `${word.y * 100}%`, fontSize: word.height * height * 0.9 }}
          >
            {word.text}{' '}
          </span>
        ))}
    </div>
  )
}

function Thumbnail({ doc, number, active, onPick }: { doc: PDFDocumentProxy; number: number; active: boolean; onPick: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    let cancelled = false
    void doc.getPage(number).then((page) => {
      if (cancelled || !canvas.current) return
      const base = page.getViewport({ scale: 1 })
      const viewport = page.getViewport({ scale: THUMB_WIDTH / base.width })
      canvas.current.width = viewport.width
      canvas.current.height = viewport.height
      void page.render({ canvas: canvas.current, canvasContext: canvas.current.getContext('2d')!, viewport }).promise.catch(() => undefined)
    })
    return () => {
      cancelled = true
    }
  }, [doc, number])
  return (
    <button type="button" aria-label={`Go to page ${number}`} aria-current={active ? 'page' : undefined} onClick={onPick} className="flex flex-col items-center gap-1 text-2xs text-text-muted">
      <canvas ref={canvas} className={cx('rounded-sm bg-[white] shadow-1', active && 'outline-2 outline-accent')} style={{ width: THUMB_WIDTH }} />
      {number}
    </button>
  )
}

export function PdfPage() {
  const url = effectiveUrl(location.href)
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [failed, setFailed] = useState<'unreadable' | 'locked' | null>(null)
  const [size, setSize] = useState({ width: 612, height: 792 })
  const [scale, setScale] = useState(1)
  const [fit, setFit] = useState(true)
  const [rotation, setRotation] = useState(0)
  const [page, setPage] = useState(1)
  const [pageInput, setPageInput] = useState('1')
  const [thumbnails, setThumbnails] = useState(false)
  const [printing, setPrinting] = useState(false)
  const [observer, setObserver] = useState<IntersectionObserver | null>(null)
  const [isScan, setIsScan] = useState(false)
  const [scanProgress, setScanProgress] = useState<string | null>(null)
  const [scanWords, setScanWords] = useState<Record<number, ScanWord[]> | null>(null)
  const scanRun = useRef<Promise<string> | null>(null)
  const scroller = useRef<HTMLDivElement>(null)

  useEffect(() => {
    document.title = fileName(url)
    void api()
      .invoke('settings:get')
      .then(({ accent }) => {
        document.documentElement.dataset.accent = accent
      })
    let task: ReturnType<typeof pdfjs.getDocument> | null = null
    void api()
      .invoke('pdf:load')
      .then(async (bytes) => {
        if (!bytes) return setFailed('unreadable')
        task = pdfjs.getDocument({ data: bytes })
        const loaded = await task.promise
        const first = await loaded.getPage(1)
        const { width, height } = first.getViewport({ scale: 1 })
        const title = (await loaded.getMetadata().catch(() => null))?.info as { Title?: string } | undefined
        if (title?.Title) document.title = title.Title
        setSize({ width, height })
        setDoc(loaded)
      })
      .catch((error: Error) => setFailed(error.name === 'PasswordException' ? 'locked' : 'unreadable'))
    return () => void task?.destroy()
  }, [url])

  // Pages say when they near the screen, and whichever crosses the middle is the current one.
  useEffect(() => {
    const root = scroller.current
    if (!doc || !root) return
    const near = new IntersectionObserver(
      (entries) => entries.forEach((entry) => entry.isIntersecting && entry.target.dispatchEvent(new Event('sc-near'))),
      { root, rootMargin: '100% 0px' }
    )
    const middle = new IntersectionObserver(
      (entries) => {
        const seen = entries.find((entry) => entry.isIntersecting)
        if (!seen) return
        const number = Number((seen.target as HTMLElement).dataset.page)
        setPage(number)
        setPageInput(String(number))
      },
      { root, rootMargin: '-50% 0px -50% 0px' }
    )
    const combined = {
      observe: (element: Element) => {
        near.observe(element)
        middle.observe(element)
      },
      unobserve: (element: Element) => {
        near.unobserve(element)
        middle.unobserve(element)
      }
    } as IntersectionObserver
    setObserver(combined)
    return () => {
      near.disconnect()
      middle.disconnect()
    }
  }, [doc])

  const startScan = useCallback(() => {
    if (!doc) return Promise.resolve('')
    scanRun.current ??= readScan(doc, (page, total) => setScanProgress(`Reading page ${page} of ${total}…`))
      .then(({ text, words }) => {
        setScanWords(words)
        return text
      })
      .catch(() => '')
      .finally(() => setScanProgress(null))
    return scanRun.current
  }, [doc])

  // A document with no text in its first pages is a scan. The assistant calls this too.
  useEffect(() => {
    if (!doc) return
    const scanner = window as unknown as { scbReadScan?: () => Promise<string> }
    scanner.scbReadScan = startScan
    void (async () => {
      for (let number = 1; number <= Math.min(doc.numPages, 3); number++) {
        const { items } = await (await doc.getPage(number)).getTextContent()
        if (items.length > 0) return
      }
      setIsScan(true)
    })()
    return () => {
      delete scanner.scbReadScan
    }
  }, [doc, startScan])

  useEffect(() => {
    const root = scroller.current
    if (!fit || !root) return
    const apply = () => {
      const width = rotation % 180 === 0 ? size.width : size.height
      setScale(Math.min(MAX_SCALE, (root.clientWidth - FIT_MARGIN) / width))
    }
    const resize = new ResizeObserver(apply)
    resize.observe(root)
    apply()
    return () => resize.disconnect()
  }, [fit, size, rotation, thumbnails])

  const goTo = useCallback((number: number) => {
    scroller.current?.querySelector(`[data-page="${number}"]`)?.scrollIntoView()
  }, [])

  const zoom = (factor: number) => {
    setFit(false)
    setScale((current) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, current * factor)))
  }

  const print = async () => {
    setPrinting(true)
    // Long enough for every page to finish drawing.
    await new Promise((resolve) => setTimeout(resolve, 300 + (doc?.numPages ?? 0) * 60))
    await api().invoke('pdf:print')
    setPrinting(false)
  }

  if (failed) {
    return (
      <main className="grid h-full place-items-center p-8">
        <div className="flex max-w-100 flex-col items-center gap-3 text-center">
          <FileText aria-hidden size={24} strokeWidth={1.5} className="text-text-faint" />
          <h1 className="text-lg font-semibold">{failed === 'locked' ? 'This PDF is password protected' : "This PDF couldn't be opened"}</h1>
          <p className="text-text-muted">The basic viewer may still be able to show it.</p>
          <Button onClick={() => void api().invoke('pdf:basic')}>Open in basic viewer</Button>
        </div>
      </main>
    )
  }

  return (
    <TooltipProvider>
      <div className="flex h-full flex-col">
        <header role="toolbar" aria-label="PDF" className="sc-pdf-chrome flex h-11 shrink-0 items-center gap-1 border-b border-border bg-surface px-2">
          <IconButton label="Pages" aria-pressed={thumbnails} onClick={() => setThumbnails(!thumbnails)}>
            <PanelLeft size={15} strokeWidth={1.75} />
          </IconButton>
          <span className="min-w-0 flex-1 truncate px-2 font-medium">{document.title}</span>
          <IconButton label="Previous page" disabled={page <= 1} onClick={() => goTo(page - 1)}>
            <ChevronLeft size={16} strokeWidth={1.75} />
          </IconButton>
          <form
            className="flex items-center gap-1.5 text-text-muted tabular-nums"
            onSubmit={(e) => {
              e.preventDefault()
              const number = Number(pageInput)
              if (doc && number >= 1 && number <= doc.numPages) goTo(number)
            }}
          >
            <Input aria-label="Page number" className="h-7 w-11 px-1 text-center" value={pageInput} onChange={(e) => setPageInput(e.target.value)} />
            of {doc?.numPages ?? '…'}
          </form>
          <IconButton label="Next page" disabled={!doc || page >= doc.numPages} onClick={() => goTo(page + 1)}>
            <ChevronRight size={16} strokeWidth={1.75} />
          </IconButton>
          <span aria-hidden className="mx-1 h-4 border-l border-border" />
          <IconButton label="Zoom out" onClick={() => zoom(1 / ZOOM_STEP)}>
            <Minus size={15} strokeWidth={1.75} />
          </IconButton>
          <span aria-label="Zoom" className="w-11 text-center text-xs text-text-muted tabular-nums">
            {Math.round(scale * 100)}%
          </span>
          <IconButton label="Zoom in" onClick={() => zoom(ZOOM_STEP)}>
            <Plus size={15} strokeWidth={1.75} />
          </IconButton>
          <IconButton label="Fit to width" aria-pressed={fit} onClick={() => setFit(true)}>
            <Maximize2 size={14} strokeWidth={1.75} />
          </IconButton>
          <IconButton label="Rotate" onClick={() => setRotation((rotation + 90) % 360)}>
            <RotateCw size={14} strokeWidth={1.75} />
          </IconButton>
          <span aria-hidden className="mx-1 h-4 border-l border-border" />
          <IconButton label="Download" onClick={() => void api().invoke('pdf:save')}>
            <Download size={15} strokeWidth={1.75} />
          </IconButton>
          <IconButton label="Print" onClick={() => void print()}>
            <Printer size={15} strokeWidth={1.75} />
          </IconButton>
        </header>
        {isScan && !scanWords && (
          <div role="status" className="sc-pdf-chrome flex h-10 shrink-0 items-center gap-2 border-b border-border bg-surface px-3">
            <ScanText aria-hidden size={15} strokeWidth={1.75} className="shrink-0 text-text-faint" />
            <span className="min-w-0 flex-1 truncate text-text-muted">{scanProgress ?? 'This is a scan. Read its text to search and select it. It stays on this computer.'}</span>
            {!scanProgress && <Button onClick={() => void startScan()}>Read text</Button>}
          </div>
        )}
        <div className="flex min-h-0 flex-1 bg-bg">
          {thumbnails && doc && (
            <nav aria-label="Pages" className="sc-pdf-chrome flex w-44 shrink-0 flex-col items-center gap-3 overflow-y-auto border-r border-border p-3">
              {Array.from({ length: doc.numPages }, (_, index) => (
                <Thumbnail key={index} doc={doc} number={index + 1} active={page === index + 1} onPick={() => goTo(index + 1)} />
              ))}
            </nav>
          )}
          <div ref={scroller} className="sc-pdf-scroll min-w-0 flex-1 overflow-auto p-6">
            {!doc && <p className="text-center text-text-faint">Opening…</p>}
            {doc && Array.from({ length: doc.numPages }, (_, index) => (
              <Page key={index} doc={doc} number={index + 1} scale={scale} rotation={rotation} size={size} renderAll={printing} observer={observer} words={scanWords?.[index + 1] ?? NO_WORDS} />
            ))}
          </div>
        </div>
      </div>
    </TooltipProvider>
  )
}
