import { Check, Moon, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { cx, IconButton } from '@scbrowser/ui'
import { MAX_MENTIONED_TABS } from '@scbrowser/shared'

export interface PickableTab {
  id: number
  title: string
  url: string
  isSleeping: boolean
}

const hostOf = (url: string) => (URL.canParse(url) ? new URL(url).host.replace(/^www\./, '') || url : url)

/** Open tabs to research, with a tick for each picked. Sleeping tabs load in the background when sent. */
export function TabPicker({ load, picked, onChange, onClose }: { load: () => Promise<PickableTab[]>; picked: number[]; onChange: (ids: number[]) => void; onClose: () => void }) {
  const [tabs, setTabs] = useState<PickableTab[] | null>(null)
  useEffect(() => void load().then(setTabs), [load])
  const full = picked.length >= MAX_MENTIONED_TABS
  return (
    <div role="dialog" aria-label="Pick tabs to research" className="flex max-h-80 flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-2">
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border pr-1 pl-3">
        <span className="min-w-0 flex-1 truncate font-medium">Research across tabs</span>
        <span className="text-xs text-text-faint tabular-nums">
          {picked.length} of {MAX_MENTIONED_TABS}
        </span>
        <IconButton size="sm" label="Done" onClick={onClose}>
          <X size={14} strokeWidth={1.75} />
        </IconButton>
      </header>
      <ul className="sc-scroll-quiet min-h-0 flex-1 overflow-y-auto p-1">
        {tabs?.length === 0 && <li className="px-2 py-2 text-xs text-text-faint">No web pages are open in this window.</li>}
        {tabs?.map((tab) => {
          const on = picked.includes(tab.id)
          return (
            <li key={tab.id}>
              <button
                type="button"
                role="checkbox"
                aria-checked={on}
                disabled={!on && full}
                onClick={() => onChange(on ? picked.filter((id) => id !== tab.id) : [...picked, tab.id])}
                className="flex h-10 w-full items-center gap-2.5 rounded-md px-2 text-left transition-colors enabled:hover:bg-surface-hover disabled:opacity-50"
              >
                <span aria-hidden className={cx('grid size-4 shrink-0 place-items-center rounded-sm transition-colors', on ? 'bg-accent text-on-accent' : 'shadow-[0_0_0_1px_var(--sc-border-strong)]')}>
                  {on && <Check size={11} strokeWidth={3} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{tab.title || hostOf(tab.url)}</span>
                  <span className="block truncate text-2xs text-text-faint">{hostOf(tab.url)}</span>
                </span>
                {tab.isSleeping && <Moon aria-label="Asleep, loads when sent" size={12} strokeWidth={1.75} className="shrink-0 text-text-faint" />}
              </button>
            </li>
          )
        })}
      </ul>
      <p className="shrink-0 border-t border-border px-3 py-2 text-2xs text-text-faint">Each picked page is sent with your messages, and replies cite them with numbers you can click.</p>
    </div>
  )
}

/** The picked tabs, shown above the message box. */
export function PickedTabs({ tabs, onRemove }: { tabs: PickableTab[]; onRemove: (id: number) => void }) {
  if (tabs.length === 0) return null
  return (
    <ul aria-label="Tabs to research" className="flex flex-wrap gap-1.5">
      {tabs.map((tab, index) => (
        <li key={tab.id} className="flex h-6 max-w-60 items-center gap-1.5 rounded-sm border border-border bg-surface pr-0.5 pl-1.5 text-xs">
          <span className="font-medium text-accent tabular-nums">{index + 1}</span>
          <span className="min-w-0 truncate">{tab.title || hostOf(tab.url)}</span>
          <IconButton size="sm" label={`Stop researching ${tab.title || hostOf(tab.url)}`} className="size-5" onClick={() => onRemove(tab.id)}>
            <X size={11} strokeWidth={2} />
          </IconButton>
        </li>
      ))}
    </ul>
  )
}
