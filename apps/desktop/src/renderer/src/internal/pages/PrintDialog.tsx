import { FileDown, Printer, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { Button, cx, IconButton, Input, Select, Switch } from '@scbrowser/ui'
import { DEFAULT_PRINT, pagesIn, parsePageRanges, type PrintChoice, type PrinterChoice } from '@scbrowser/shared'
import { api } from '../api'

const PREVIEW_WIDTH = 150
/** Enough to see what's chosen, without drawing a whole long document. */
const MAX_PREVIEW = 12

function Sheet({ doc, number, landscape, color }: { doc: PDFDocumentProxy; number: number; landscape: boolean; color: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    let cancelled = false
    void doc.getPage(number).then((page) => {
      if (cancelled || !canvas.current) return
      const base = page.getViewport({ scale: 1 })
      const viewport = page.getViewport({ scale: (PREVIEW_WIDTH * 2) / base.width })
      canvas.current.width = viewport.width
      canvas.current.height = viewport.height
      void page.render({ canvas: canvas.current, canvasContext: canvas.current.getContext('2d')!, viewport }).promise.catch(() => undefined)
    })
    return () => {
      cancelled = true
    }
  }, [doc, number])
  return (
    <figure className="flex flex-col items-center gap-1.5">
      <div
        className={cx('grid place-items-center overflow-hidden rounded-sm bg-[white] p-2 shadow-1 transition-[width,height] duration-150')}
        style={landscape ? { width: PREVIEW_WIDTH * 1.29, height: PREVIEW_WIDTH } : { width: PREVIEW_WIDTH, height: PREVIEW_WIDTH * 1.29 }}
      >
        <canvas ref={canvas} className="max-h-full max-w-full object-contain" style={{ filter: color ? undefined : 'grayscale(1)' }} />
      </div>
      <figcaption className="text-2xs text-text-muted tabular-nums">{number}</figcaption>
    </figure>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-2xs font-semibold tracking-[0.06em] text-text-muted uppercase">{label}</span>
      {children}
    </div>
  )
}

function Segmented<T extends string | boolean>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (value: T) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-md border border-border p-0.5">
      {options.map(([option, text]) => (
        <button
          key={String(option)}
          type="button"
          role="radio"
          aria-checked={value === option}
          onClick={() => onChange(option)}
          className={cx('h-7 flex-1 rounded-sm px-2 text-sm', value === option ? 'bg-surface-hover font-medium text-text' : 'text-text-muted hover:text-text')}
        >
          {text}
        </button>
      ))}
    </div>
  )
}

/**
 * A print box drawn by scTerra, with a live preview, in place of the system's own. The system box
 * is still one click away for anything this doesn't offer.
 */
export function PrintDialog({ doc, onClose, onPrint, onSystem }: { doc: PDFDocumentProxy; onClose: () => void; onPrint: (choice: PrintChoice) => Promise<string | null>; onSystem: () => void }) {
  const [printers, setPrinters] = useState<PrinterChoice[] | null>(null)
  const [choice, setChoice] = useState<PrintChoice>(DEFAULT_PRINT)
  const [some, setSome] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const set = (patch: Partial<PrintChoice>) => setChoice((old) => ({ ...old, ...patch }))

  useEffect(() => {
    void api()
      .invoke('pdf:printers')
      .then((list) => {
        setPrinters(list)
        set({ destination: (list.find((printer) => printer.isDefault) ?? list[0])?.name ?? 'pdf' })
      })
  }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const ranges = parsePageRanges(some ? choice.pages : '', doc.numPages)
  const pages = useMemo(() => (ranges ? pagesIn(ranges) : []), [ranges && JSON.stringify(ranges)])
  const toPdf = choice.destination === 'pdf'
  const sheets = Math.ceil((pages.length * (toPdf ? 1 : choice.copies)) / (choice.twoSided && !toPdf ? 2 : 1))

  const submit = async () => {
    if (!ranges) return setProblem(`Use page numbers from 1 to ${doc.numPages}, like 1-3, 5.`)
    setBusy(true)
    setProblem(null)
    const failed = await onPrint({ ...choice, pages: some ? choice.pages : '' }).catch((error: Error) => error.message)
    setBusy(false)
    if (failed) setProblem(failed)
    else onClose()
  }

  return (
    <div className="sc-pdf-chrome fixed inset-0 z-50 grid place-items-center bg-[oklch(0_0_0/0.35)] p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label="Print" className="flex h-[min(640px,100%)] w-[min(880px,100%)] overflow-hidden rounded-lg border border-border bg-surface shadow-2">
        <section aria-label="Preview" className="min-w-0 flex-1 overflow-y-auto bg-bg p-6">
          {pages.length === 0 ? (
            <p className="grid h-full place-items-center text-text-muted">No pages chosen</p>
          ) : (
            <div className="flex flex-wrap content-start justify-center gap-5">
              {pages.slice(0, MAX_PREVIEW).map((number) => (
                <Sheet key={number} doc={doc} number={number} landscape={choice.landscape} color={choice.color || toPdf} />
              ))}
              {pages.length > MAX_PREVIEW && <p className="w-full text-center text-xs text-text-muted">and {pages.length - MAX_PREVIEW} more</p>}
            </div>
          )}
        </section>
        <form
          aria-label="Print settings"
          className="flex w-80 shrink-0 flex-col border-l border-border"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <header className="flex h-12 shrink-0 items-center justify-between border-b border-border pr-2 pl-4">
            <h2 className="font-semibold">Print</h2>
            <span className="ml-auto pr-2 text-xs text-text-muted tabular-nums">{toPdf ? `${pages.length} ${pages.length === 1 ? 'page' : 'pages'}` : `${sheets} ${sheets === 1 ? 'sheet' : 'sheets'} of paper`}</span>
            <IconButton size="sm" label="Close" onClick={onClose}>
              <X size={14} strokeWidth={1.75} />
            </IconButton>
          </header>
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
            <Field label="Destination">
              <Select aria-label="Destination" value={choice.destination} disabled={!printers} onChange={(e) => set({ destination: e.target.value })}>
                {printers?.map((printer) => (
                  <option key={printer.name} value={printer.name}>
                    {printer.displayName}
                  </option>
                ))}
                <option value="pdf">Save as PDF</option>
              </Select>
              {printers?.length === 0 && <span className="text-xs text-text-muted">No printers found. You can still save as PDF.</span>}
            </Field>
            <Field label="Pages">
              <Segmented label="Pages" value={some} options={[[false, 'All'], [true, 'Custom']]} onChange={setSome} />
              {some && (
                <Input
                  autoFocus
                  aria-label="Page range"
                  aria-invalid={!ranges}
                  placeholder={`e.g. 1-${Math.min(3, doc.numPages)}, ${doc.numPages}`}
                  value={choice.pages}
                  onChange={(e) => set({ pages: e.target.value })}
                />
              )}
            </Field>
            {!toPdf && (
              <Field label="Copies">
                <Input type="number" aria-label="Copies" min={1} max={99} value={choice.copies} onChange={(e) => set({ copies: Math.min(99, Math.max(1, Math.round(Number(e.target.value) || 1))) })} />
              </Field>
            )}
            <Field label="Layout">
              <Segmented label="Layout" value={choice.landscape} options={[[false, 'Portrait'], [true, 'Landscape']]} onChange={(landscape) => set({ landscape })} />
            </Field>
            {!toPdf && (
              <>
                <Field label="Colour">
                  <Segmented label="Colour" value={choice.color} options={[[true, 'Colour'], [false, 'Black and white']]} onChange={(color) => set({ color })} />
                </Field>
                <label className="flex items-center justify-between gap-3">
                  Print on both sides
                  <Switch label="Print on both sides" checked={choice.twoSided} onChange={(twoSided) => set({ twoSided })} />
                </label>
              </>
            )}
            {problem && (
              <p role="alert" className="text-xs text-danger">
                {problem}
              </p>
            )}
          </div>
          <footer className="flex shrink-0 flex-col gap-2 border-t border-border p-4">
            <div className="flex gap-2">
              <Button type="submit" variant="primary" className="flex-1" disabled={busy || !ranges || pages.length === 0 || !printers}>
                {toPdf ? <FileDown aria-hidden size={14} strokeWidth={1.75} /> : <Printer aria-hidden size={14} strokeWidth={1.75} />}
                {busy ? (toPdf ? 'Saving…' : 'Printing…') : toPdf ? 'Save' : 'Print'}
              </Button>
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
            </div>
            <button type="button" className="self-start text-xs text-text-muted underline-offset-2 hover:text-text hover:underline" onClick={onSystem}>
              Use the system print dialog…
            </button>
          </footer>
        </form>
      </div>
    </div>
  )
}
