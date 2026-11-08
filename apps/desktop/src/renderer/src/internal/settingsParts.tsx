import { RotateCcw } from 'lucide-react'
import { createContext, useContext, type ComponentProps, type ReactNode } from 'react'
import { cx, IconButton, Select } from '@scbrowser/ui'
import { isChangedSetting, type Settings } from '@scbrowser/shared'

/**
 * Settings search: each row knows the words around it (its page, its section, its own label, hint
 * and keywords), and hides itself when they don't hold every word searched for. Sections and pages
 * with nothing left showing are hidden by CSS (`[data-settings-searching]` in internal.css).
 */
const SearchScope = createContext<{ words: string[]; around: string }>({ words: [], around: '' })

export const searchWords = (query: string) => query.toLowerCase().split(/\s+/).filter(Boolean)

const holds = (words: string[], text: string) => {
  const haystack = text.toLowerCase()
  return words.every((word) => haystack.includes(word))
}

/** The values rows compare with their defaults, and whether only changed ones show. */
interface SettingValues {
  values: Settings | null
  changedOnly: boolean
  reset: (key: keyof Settings) => void
}
const Values = createContext<SettingValues>({ values: null, changedOnly: false, reset: () => {} })

export function SearchProvider({ words, values, children }: { words: string[]; values?: SettingValues; children: ReactNode }) {
  return (
    <Values.Provider value={values ?? { values: null, changedOnly: false, reset: () => {} }}>
      <SearchScope.Provider value={{ words, around: '' }}>{children}</SearchScope.Provider>
    </Values.Provider>
  )
}

/** Adds words that rows inside count as their own, like their section's title. */
function Around({ text, children }: { text: string; children: ReactNode }) {
  const scope = useContext(SearchScope)
  return <SearchScope.Provider value={{ words: scope.words, around: `${scope.around} ${text}` }}>{children}</SearchScope.Provider>
}

/** Whether something with this text shows under the current search. */
export function useShown(text: string): boolean {
  const { words, around } = useContext(SearchScope)
  return words.length === 0 || holds(words, `${around} ${text}`)
}

export function Group({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <div data-settings-group={id} className="flex flex-col gap-6">
      <h2 className="text-md font-semibold tracking-[-0.01em]">{title}</h2>
      <Around text={title}>{children}</Around>
    </div>
  )
}

export function Section({ title, description, keywords = '', children }: { title: string; description?: ReactNode; keywords?: string; children: ReactNode }) {
  return (
    <section aria-label={title} data-settings-section className="flex flex-col gap-1.5">
      <div className="px-1 pb-0.5">
        <h3 className="text-sm font-medium">{title}</h3>
        {description && <p className="text-xs text-text-faint">{description}</p>}
      </div>
      <div className="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface">
        <Around text={`${title} ${keywords}`}>{children}</Around>
      </div>
    </section>
  )
}

/** A setting: its name and what it does on the left, its control on the right. */
export function Row({ label, hint, keywords = '', tone, setting, children }: { label: string; hint?: ReactNode; keywords?: string; tone?: 'danger'; setting?: keyof Settings; children?: ReactNode }) {
  const shown = useShown(`${label} ${typeof hint === 'string' ? hint : ''} ${keywords}`)
  const { values, changedOnly, reset } = useContext(Values)
  const changed = !!setting && !!values && isChangedSetting(setting, values[setting])
  if (!shown || (changedOnly && !changed)) return null
  return (
    // Wraps rather than squeezing the words, so a wide control drops under them in a narrow window.
    <div data-setting className="flex min-h-12 flex-wrap items-center justify-between gap-x-6 gap-y-2 px-3 py-2 [&>*:last-child:not(:first-child)]:shrink-0">
      <div className="min-w-0 flex-1 basis-48 [overflow-wrap:anywhere]">
        <div className={cx(tone === 'danger' && 'text-danger')} role={tone === 'danger' ? 'alert' : undefined}>
          {label}
        </div>
        {hint && <div className="text-xs text-text-faint">{hint}</div>}
      </div>
      {changed ? (
        <div className="flex items-center gap-1">
          <IconButton size="sm" label={`Reset ${label} to default`} className="text-text-faint" onClick={() => reset(setting!)}>
            <RotateCcw aria-hidden size={12} strokeWidth={2} />
          </IconButton>
          {children}
        </div>
      ) : (
        children
      )}
    </div>
  )
}

/** Anything in a section that isn't a plain row, shown while its words hold for the search. */
export function Searchable({ text, children }: { text: string; children: ReactNode }) {
  if (!useShown(text)) return null
  return (
    <div data-setting className="flex flex-col divide-y divide-border">
      {children}
    </div>
  )
}

/** The same width everywhere, so the choices line up in a column down the page. */
export function RowSelect(props: ComponentProps<typeof Select>) {
  return <Select {...props} className="w-60 max-w-full shrink-0" />
}

/** A set of on-or-off choices in one row, instead of a row and a switch for each. */
export function ChipToggles<T extends string>({ label, options, isOn, onToggle }: { label: string; options: readonly { id: T; name: string }[]; isOn: (id: T) => boolean; onToggle: (id: T, on: boolean) => void }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap justify-end gap-1.5">
      {options.map((option) => {
        const on = isOn(option.id)
        return (
          <button
            key={option.id}
            type="button"
            aria-pressed={on}
            onClick={() => onToggle(option.id, !on)}
            className={cx(
              'flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-xs transition-colors',
              'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring',
              on ? 'border-accent bg-accent-soft text-text' : 'border-border text-text-muted hover:bg-surface-hover hover:text-text'
            )}
          >
            <span aria-hidden className={cx('size-1.5 rounded-full', on ? 'bg-accent' : 'bg-border-strong')} />
            {option.name}
          </button>
        )
      })}
    </div>
  )
}
