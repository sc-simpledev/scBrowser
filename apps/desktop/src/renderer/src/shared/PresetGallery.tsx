import { BookOpen, Briefcase, Columns3, FileText, GraduationCap, History, Info, LayoutGrid, Library, Lightbulb, ListChecks, Map, Newspaper, Scale, Signpost, Star, Trash2, Users, X, type LucideIcon } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { cx, IconButton } from '@scbrowser/ui'
import { REPORT_PRESETS, REPORT_THEMES, type ReportPreset } from '@scbrowser/shared'

const ICONS: Record<string, LucideIcon> = { BookOpen, Briefcase, Columns3, GraduationCap, History, Info, LayoutGrid, Library, Lightbulb, ListChecks, Map, Newspaper, Scale, Signpost, Star, Users }

export const presetIcon = (preset: ReportPreset): LucideIcon => ICONS[preset.icon] ?? FileText

const themeName = (id: string) => REPORT_THEMES.find((theme) => theme.id === id)?.name ?? id

/** Every kind of report, to start one from. Nothing is sent until the message is. */
export function PresetGallery({ onPick, onClose, wide = false, custom = [], onDelete }: { onPick: (preset: ReportPreset) => void; onClose: () => void; wide?: boolean; custom?: ReportPreset[]; onDelete?: (id: string) => void }) {
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    root.current?.querySelector<HTMLButtonElement>('button[data-preset]')?.focus()
    const escape = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [onClose])
  return (
    <div ref={root} role="dialog" aria-label="Report presets" className="flex max-h-[min(440px,60vh)] flex-col overflow-hidden rounded-lg bg-surface shadow-2">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border pr-1.5 pl-3">
        <FileText aria-hidden size={14} strokeWidth={1.75} className="text-accent" />
        <span className="min-w-0 flex-1 font-medium">Make a report</span>
        <IconButton size="sm" label="Close presets" onClick={onClose}>
          <X size={13} strokeWidth={2} />
        </IconButton>
      </div>
      <div className="sc-scroll-quiet flex min-h-0 flex-col gap-2 overflow-y-auto p-2">
        {custom.length > 0 && (
          <section aria-label="Your templates" className="flex flex-col gap-1.5">
            <h3 className="px-1 text-2xs font-semibold tracking-[0.06em] text-text-muted uppercase">Yours</h3>
            <div className={cx('grid gap-1.5', wide ? 'grid-cols-[repeat(auto-fill,minmax(200px,1fr))]' : 'grid-cols-2')}>
              {custom.map((preset) => (
                <PresetButton key={preset.id} preset={preset} onPick={onPick} onDelete={onDelete} />
              ))}
            </div>
            <h3 className="px-1 pt-1 text-2xs font-semibold tracking-[0.06em] text-text-muted uppercase">Built in</h3>
          </section>
        )}
        <div className={cx('grid gap-1.5', wide ? 'grid-cols-[repeat(auto-fill,minmax(200px,1fr))]' : 'grid-cols-2')}>
          {REPORT_PRESETS.map((preset) => (
            <PresetButton key={preset.id} preset={preset} onPick={onPick} />
          ))}
        </div>
      </div>
    </div>
  )
}

function PresetButton({ preset, onPick, onDelete }: { preset: ReportPreset; onPick: (preset: ReportPreset) => void; onDelete?: (id: string) => void }) {
  const Icon = presetIcon(preset)
  return (
    <div className="group relative flex min-w-0">
      <button
        type="button"
        data-preset={preset.id}
        title={`${preset.description}. ${themeName(preset.theme)} design.`}
        onClick={() => onPick(preset)}
        className="flex min-w-0 flex-1 flex-col items-start gap-1.5 rounded-md border border-border p-2.5 text-left transition-colors hover:border-border-strong hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-focus-ring"
      >
        <span className="flex size-7 items-center justify-center rounded-md bg-accent-soft text-accent">
          <Icon aria-hidden size={14} strokeWidth={1.75} />
        </span>
        <span className="w-full truncate pr-5 text-xs font-medium">{preset.name}</span>
        <span className="line-clamp-2 text-2xs leading-snug text-text-faint">{preset.description}</span>
      </button>
      {onDelete && (
        <IconButton size="sm" label={`Delete the ${preset.name} template`} className="absolute top-1.5 right-1.5 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100" onClick={() => onDelete(preset.id)}>
          <Trash2 size={12} strokeWidth={1.75} />
        </IconButton>
      )}
    </div>
  )
}

/** The chosen preset, above the composer, until it's sent or taken off. */
export function PresetChip({ preset, onRemove }: { preset: ReportPreset; onRemove: () => void }) {
  const Icon = presetIcon(preset)
  return (
    <div className="flex items-center gap-1.5 rounded-md bg-accent-soft px-2 py-1 text-xs text-accent">
      <Icon aria-hidden size={12} strokeWidth={1.75} className="shrink-0" />
      <span className="min-w-0 flex-1 truncate font-medium">{preset.name} report</span>
      <IconButton size="sm" label={`Don't make a ${preset.name} report`} onClick={onRemove}>
        <X size={12} strokeWidth={2} />
      </IconButton>
    </div>
  )
}
