import { ChevronLeft, ChevronRight, Maximize2, NotebookPen, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, cx, IconButton } from '@scbrowser/ui'
import { reportSlides, type Report, type Slide, type SlideLine } from '@scbrowser/shared'
import { Thinking } from './ReplyContent'

function Line({ line, index }: { line: SlideLine; index: number }) {
  return (
    <li className={cx('flex gap-[0.6em]', line.level === 1 && 'ml-[1.4em]', line.bold && 'font-semibold', line.italic && 'italic', line.accent && 'text-accent')}>
      {(line.bullet || line.numbered) && (
        <span aria-hidden className="w-[1.2em] shrink-0 text-right text-accent tabular-nums">
          {line.numbered ? `${index}.` : '•'}
        </span>
      )}
      <span className="min-w-0">
        {line.lead && <span className="font-semibold">{line.lead} </span>}
        {line.text}
      </span>
    </li>
  )
}

/** One slide, sized in ems so it scales with the stage it's on. All text is set as React text. */
function SlideView({ slide }: { slide: Slide }) {
  if (slide.kind === 'title') {
    return (
      <div className="flex h-full flex-col justify-center gap-[0.8em] px-[4em]">
        {slide.label && <p className="text-[0.8em] font-semibold tracking-[0.08em] text-accent uppercase">{slide.label}</p>}
        <h2 className="text-[2.6em] leading-tight font-semibold tracking-[-0.03em]">{slide.title}</h2>
        {slide.subtitle && <p className="max-w-[32em] text-[1.15em] text-text-muted">{slide.subtitle}</p>}
      </div>
    )
  }
  let number = 0
  return (
    <div className="flex h-full flex-col gap-[1.2em] px-[3.2em] py-[2.4em]">
      <h2 className="shrink-0 border-b-2 border-accent pb-[0.4em] text-[1.7em] leading-tight font-semibold tracking-[-0.02em]">{slide.title}</h2>
      <div className="flex min-h-0 flex-1 flex-col justify-center overflow-hidden">
        {slide.kind === 'text' && (
          <ul className={cx('flex flex-col gap-[0.55em]', slide.lines.length <= 4 ? 'text-[1.35em]' : 'text-[1em]')}>
            {slide.lines.map((line, index) => {
              // Numbering starts again after anything that isn't a numbered line.
              number = line.numbered ? number + 1 : line.level === 1 ? number : 0
              return <Line key={index} line={line} index={number} />
            })}
          </ul>
        )}
        {slide.kind === 'table' && (
          <table className="w-full border-collapse text-[0.9em]">
            <thead>
              <tr>
                {slide.headers.map((header, index) => (
                  <th key={index} className="border-b-2 border-border-strong px-[0.7em] py-[0.5em] text-left font-semibold">
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {slide.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, index) => (
                    <td key={index} className="border-b border-border px-[0.7em] py-[0.5em] align-top">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {slide.kind === 'stats' && (
          <div className="grid grid-cols-[repeat(auto-fit,minmax(8em,1fr))] gap-[1.2em]">
            {slide.items.map((item, index) => (
              <div key={index} className="flex flex-col gap-[0.3em] rounded-lg border border-border p-[1.1em]">
                <span className="text-[2.4em] leading-none font-semibold tracking-[-0.03em] text-accent">{item.value}</span>
                <span className="text-[0.95em] text-text-muted">{item.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * A report shown one slide at a time, split the same way as its PowerPoint download. Arrow keys
 * and Space move through it, F fills the screen and Esc leaves. Speaker notes are written by the
 * person's AI only when asked for.
 */
export function PresentMode({ report, loadNotes, onClose }: { report: Report; loadNotes?: () => Promise<string[]>; onClose: () => void }) {
  const slides = useMemo(() => reportSlides(report), [report])
  const [index, setIndex] = useState(0)
  const [notes, setNotes] = useState<string[] | 'loading' | 'failed' | null>(null)
  const [showNotes, setShowNotes] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const last = slides.length - 1
  const fill = () => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void root.current?.requestFullscreen().catch(() => undefined)
  }
  const toggleNotes = () => {
    setShowNotes(!showNotes)
    if (notes !== null || !loadNotes) return
    setNotes('loading')
    loadNotes().then(
      (written) => setNotes(written.some(Boolean) ? written : 'failed'),
      () => setNotes('failed')
    )
  }
  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown' || event.key === 'PageDown' || event.key === ' ') setIndex((at) => Math.min(last, at + 1))
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp' || event.key === 'PageUp') setIndex((at) => Math.max(0, at - 1))
      else if (event.key === 'Home') setIndex(0)
      else if (event.key === 'End') setIndex(last)
      else if (event.key === 'f' || event.key === 'F') fill()
      // Esc leaves full screen first, as the browser does by itself, and then the slides.
      else if (event.key === 'Escape' && !document.fullscreenElement) onClose()
      else return
      event.preventDefault()
    }
    window.addEventListener('keydown', keys)
    return () => window.removeEventListener('keydown', keys)
  }, [last, onClose])
  useEffect(() => () => void (document.fullscreenElement && document.exitFullscreen()), [])
  const slide = slides[index]!
  const note = Array.isArray(notes) ? notes[index] : null
  return (
    <div ref={root} role="dialog" aria-label="Slides" data-theme={report.theme} className="fixed inset-0 z-50 flex flex-col bg-bg">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-surface pr-2 pl-4">
        <div className="min-w-0 flex-1 truncate font-medium">{report.title}</div>
        <span role="status" className="text-xs text-text-muted tabular-nums">
          Slide {index + 1} of {slides.length}
        </span>
        {loadNotes && (
          <Button className="shrink-0 px-2.5 text-xs" aria-pressed={showNotes} title="What to say for each slide, written by your AI" onClick={toggleNotes}>
            <NotebookPen aria-hidden size={14} strokeWidth={1.75} className="text-accent" />
            Speaker notes
          </Button>
        )}
        <IconButton label="Full screen" shortcut="F" onClick={fill}>
          <Maximize2 size={15} strokeWidth={1.75} />
        </IconButton>
        <IconButton label="Close slides" shortcut="Esc" onClick={onClose}>
          <X size={15} strokeWidth={1.75} />
        </IconButton>
      </header>
      <div className="flex min-h-0 flex-1 items-center justify-center gap-3 p-4">
        <IconButton label="Previous slide" disabled={index === 0} onClick={() => setIndex(index - 1)}>
          <ChevronLeft size={18} strokeWidth={1.75} />
        </IconButton>
        {/* As big as fits at 16:9, with the type scaled to it. */}
        <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center self-stretch [container-type:size]">
          <div aria-live="polite" className="h-[min(56.25cqw,100cqh)] w-[min(100cqw,177.78cqh)] overflow-hidden rounded-lg border border-border bg-surface text-[2.2cqmin] shadow-2 select-text">
            <SlideView slide={slide} />
          </div>
        </div>
        <IconButton label="Next slide" disabled={index === last} onClick={() => setIndex(index + 1)}>
          <ChevronRight size={18} strokeWidth={1.75} />
        </IconButton>
      </div>
      {showNotes && (
        <div role="region" aria-label="Speaker notes" className="sc-scroll-quiet max-h-40 shrink-0 overflow-y-auto border-t border-border bg-surface px-6 py-3 select-text">
          {notes === 'loading' ? <Thinking label="Writing speaker notes" /> : notes === 'failed' ? <p className="text-text-muted">The notes couldn’t be written. Try again in a moment.</p> : <p className="mx-auto max-w-180 whitespace-pre-wrap">{note || 'No notes for this slide.'}</p>}
        </div>
      )}
    </div>
  )
}
