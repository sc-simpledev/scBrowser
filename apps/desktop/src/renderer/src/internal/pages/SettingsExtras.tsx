import { Plus, X } from 'lucide-react'
import { Fragment, useEffect, useRef, useState } from 'react'
import { Button, cx, Input, Select } from '@scbrowser/ui'
import {
  CLEAR_KINDS,
  CLEAR_RANGES,
  comboFromKey,
  comboLabel,
  FIXED_SHORTCUTS,
  GESTURE_ACTIONS,
  gestureArrows,
  isFixedCombo,
  isUsableCombo,
  isWebAddress,
  MAX_KEYS_PER_SHORTCUT,
  MAX_STARTUP_PAGES,
  SHORTCUT_GROUPS,
  SHORTCUTS,
  shortcutKeys,
  shortcutUsing,
  type ClearKind,
  type ClearRange,
  type Settings,
  type ShortcutId
} from '@scbrowser/shared'
import { api } from '../api'
import { Row, Searchable, Section } from '../settingsParts'

type Update = (patch: Partial<Settings>) => void

const platform = () => (navigator.userAgent.includes('Mac OS') ? 'darwin' : 'other')

/** A web address from what was typed: `example.com` gets https:// in front. */
export function typedAddress(text: string): string | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  const address = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`
  return isWebAddress(address) ? address : null
}

/** Clear browsing data: a time and what to clear, then one button. */
export function ClearDataPanel() {
  const [range, setRange] = useState<ClearRange>('hour')
  const [kinds, setKinds] = useState<ClearKind[]>(['history', 'cache'])
  const [state, setState] = useState<'idle' | 'clearing' | 'done'>('idle')
  const [error, setError] = useState<string | null>(null)
  const clear = () => {
    setState('clearing')
    setError(null)
    api()
      .invoke('data:clear', range, kinds)
      .then(() => setState('done'))
      .catch((reason: unknown) => {
        setState('idle')
        setError(reason instanceof Error ? reason.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : 'Couldn’t clear that.')
      })
  }
  return (
    <>
      <Row label="Time range" keywords="clear delete erase history cookies cache">
        <Select
          aria-label="Time range"
          className="w-44"
          value={range}
          onChange={(e) => {
            setRange(e.target.value as ClearRange)
            setState('idle')
          }}
        >
          {CLEAR_RANGES.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </Select>
      </Row>
      <Searchable text="clear delete history downloads cookies site data cache">
        <fieldset className="flex flex-col gap-0.5 px-3 py-2">
          <legend className="sr-only">What to clear</legend>
          {CLEAR_KINDS.map((kind) => (
            <label key={kind.id} className="flex cursor-pointer items-start gap-2.5 rounded-md px-1 py-1.5 hover:bg-surface-hover">
              <input
                type="checkbox"
                className="mt-0.5 size-4 shrink-0 accent-(--sc-accent)"
                checked={kinds.includes(kind.id)}
                onChange={(e) => {
                  setKinds((current) => (e.target.checked ? [...current, kind.id] : current.filter((other) => other !== kind.id)))
                  setState('idle')
                }}
              />
              <span className="min-w-0">
                <span className="block text-sm">{kind.label}</span>
                <span className="block text-xs text-text-faint">{kind.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>
      </Searchable>
      <Searchable text="clear data now">
        <div className="flex flex-wrap items-center justify-end gap-3 px-3 py-2.5">
          {error && (
            <span role="alert" className="mr-auto text-xs text-danger">
              {error}
            </span>
          )}
          {state === 'done' && (
            <span role="status" className="mr-auto text-xs text-text-muted">
              Cleared.
            </span>
          )}
          <Button variant="primary" disabled={kinds.length === 0 || state === 'clearing'} onClick={clear}>
            {state === 'clearing' ? 'Clearing…' : 'Clear data'}
          </Button>
        </div>
      </Searchable>
    </>
  )
}

/** Addresses opened at start, in order, with a box to add one. */
export function StartupPages({ settings, update }: { settings: Settings; update: Update }) {
  const [draft, setDraft] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const pages = settings.startupPages
  const add = (address: string | null) => {
    if (!address) return setProblem('That isn’t a web address.')
    if (pages.includes(address)) return setProblem('That page is already in the list.')
    update({ startupPages: [...pages, address].slice(0, MAX_STARTUP_PAGES) })
    setDraft('')
    setProblem(null)
  }
  return (
    <div className="flex flex-col gap-2 px-3 py-2.5">
      {pages.length === 0 && <p className="text-xs text-text-faint">No pages yet. Until you add one, a new tab opens.</p>}
      {pages.length > 0 && (
        <ul className="flex flex-col gap-1">
          {pages.map((page) => (
            <li key={page} className="flex h-8 items-center gap-2 rounded-md border border-border px-2 text-sm">
              <span className="min-w-0 flex-1 truncate" title={page}>
                {page.replace(/^https?:\/\//, '')}
              </span>
              <button type="button" aria-label={`Remove ${page}`} className="grid size-6 shrink-0 place-items-center rounded-sm text-text-muted hover:bg-surface-hover hover:text-text" onClick={() => update({ startupPages: pages.filter((other) => other !== page) })}>
                <X size={14} strokeWidth={1.75} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          add(typedAddress(draft))
        }}
      >
        <Input aria-label="Page to open at start" placeholder="example.com" className="min-w-0 flex-1 basis-48" value={draft} onChange={(e) => setDraft(e.target.value)} />
        <Button type="submit" disabled={!draft.trim() || pages.length >= MAX_STARTUP_PAGES}>
          <Plus size={14} strokeWidth={1.75} /> Add
        </Button>
        <Button type="button" variant="ghost" onClick={() => void api().invoke('startup:open-tabs').then((addresses) => addresses.length > 0 && update({ startupPages: [...new Set([...pages, ...addresses])].slice(0, MAX_STARTUP_PAGES) }))}>
          Use open tabs
        </Button>
      </form>
      {problem && (
        <p role="alert" className="text-xs text-danger">
          {problem}
        </p>
      )}
    </div>
  )
}

/** Home: the new tab page, or an address. */
export function HomePageRow({ settings, update }: { settings: Settings; update: Update }) {
  const [draft, setDraft] = useState(settings.homePage)
  const [problem, setProblem] = useState(false)
  useEffect(() => setDraft(settings.homePage), [settings.homePage])
  const save = () => {
    if (!draft.trim()) {
      setProblem(false)
      return update({ homePage: '' })
    }
    const address = typedAddress(draft)
    setProblem(!address)
    if (address) update({ homePage: address })
  }
  return (
    <Row setting="homePage" label="Home page" hint={problem ? 'That isn’t a web address.' : 'Where Home and Alt Home go. Leave it empty for the new tab page.'} tone={problem ? 'danger' : undefined} keywords="home button start">
      <Input
        aria-label="Home page"
        placeholder="New tab page"
        className="w-56"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === 'Enter') save()
        }}
      />
    </Row>
  )
}

/** Sites in a list the person keeps, each with a button to take it out. */
export function SiteList({ sites, empty, onRemove, removeLabel = 'Remove' }: { sites: string[]; empty: string; onRemove: (site: string) => void; removeLabel?: string }) {
  if (sites.length === 0)
    return (
      <Searchable text={empty}>
        <p className="px-3 py-3 text-xs text-text-faint">{empty}</p>
      </Searchable>
    )
  return (
    <>
      {sites.map((site) => (
        <Row key={site} label={site}>
          <Button variant="ghost" onClick={() => onRemove(site)}>
            {removeLabel}
          </Button>
        </Row>
      ))}
    </>
  )
}

/** The gestures there are, as arrows. */
export function GestureList() {
  return (
    <Searchable text={`gestures ${GESTURE_ACTIONS.map((gesture) => gesture.label).join(' ')}`}>
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 px-3 py-2.5 text-sm sm:grid-cols-[auto_1fr_auto_1fr]">
        {GESTURE_ACTIONS.map((gesture) => (
          <Fragment key={gesture.id}>
            <dt className="font-mono text-text-muted" aria-label={gesture.path}>
              {gestureArrows(gesture.path)}
            </dt>
            <dd>{gesture.label}</dd>
          </Fragment>
        ))}
      </dl>
    </Searchable>
  )
}

/** One key, as a key cap. */
function KeyCap({ combo, onRemove }: { combo: string; onRemove?: () => void }) {
  const label = comboLabel(combo, platform())
  return (
    <span className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-bg pr-1 pl-2 font-sans text-xs font-medium text-text shadow-[0_1px_0_var(--sc-border)]">
      <kbd className="font-sans">{label}</kbd>
      {onRemove && (
        <button type="button" aria-label={`Remove ${label}`} className="grid size-5 place-items-center rounded-sm text-text-faint hover:bg-surface-hover hover:text-text" onClick={onRemove}>
          <X size={12} strokeWidth={2} />
        </button>
      )}
    </span>
  )
}

/** A shortcut's keys, a button to add one by pressing it, and Reset once it's changed. */
function ShortcutRow({ id, label, settings, update, recording, setRecording }: { id: ShortcutId; label: string; settings: Settings; update: Update; recording: ShortcutId | null; setRecording: (id: ShortcutId | null) => void }) {
  const overrides = settings.shortcuts
  const keys = shortcutKeys(id, overrides)
  const changed = id in overrides
  const listening = recording === id
  const [note, setNote] = useState<string | null>(null)
  const box = useRef<HTMLButtonElement>(null)
  const setKeys = (next: string[], moved: Record<string, string[]> = {}) => update({ shortcuts: { ...overrides, ...moved, [id]: next } })

  useEffect(() => {
    if (!listening) return
    void api().invoke('shortcuts:recording', true)
    box.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopPropagation()
      if (event.key === 'Escape' && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey) return setRecording(null)
      const combo = comboFromKey(event, platform())
      if (!combo) return
      if (!isUsableCombo(combo)) return setNote('Use Ctrl or Alt with a key, or a function key: other keys belong to the page.')
      if (isFixedCombo(combo)) return setNote(`${comboLabel(combo, platform())} picks a tab or workspace by its place, and can’t be changed.`)
      if (keys.includes(combo)) return setRecording(null)
      // A key another shortcut had leaves it, so each key does one thing.
      const other = shortcutUsing(combo, overrides, id)
      const moved = other ? { [other]: shortcutKeys(other, overrides).filter((key) => key !== combo) } : {}
      setKeys([...keys, combo].slice(-MAX_KEYS_PER_SHORTCUT), moved)
      setNote(other ? `Moved from ${SHORTCUTS.find((shortcut) => shortcut.id === other)!.label}.` : null)
      setRecording(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      void api().invoke('shortcuts:recording', false)
    }
  }, [listening])

  return (
    <Row label={label} hint={note ?? undefined} keywords={`shortcut key ${keys.map((key) => comboLabel(key, platform())).join(' ')}`}>
      <div className="flex flex-wrap items-center justify-end gap-1.5">
        {keys.length === 0 && !listening && <span className="text-xs text-text-faint">None</span>}
        {keys.map((key) => (
          <KeyCap key={key} combo={key} onRemove={() => setKeys(keys.filter((other) => other !== key))} />
        ))}
        <button
          ref={box}
          type="button"
          aria-label={listening ? `Press the keys for ${label}` : `Add a key for ${label}`}
          aria-pressed={listening}
          disabled={!listening && keys.length >= MAX_KEYS_PER_SHORTCUT}
          onClick={() => setRecording(listening ? null : id)}
          onBlur={() => listening && setRecording(null)}
          className={cx(
            'inline-flex h-7 items-center gap-1 rounded-md border px-2 text-xs transition-[background-color,color,opacity] duration-(--sc-duration-fast) disabled:hidden',
            listening ? 'border-accent bg-accent-soft text-text' : 'border-dashed border-border-strong text-text-muted hover:bg-surface-hover hover:text-text',
            // Quiet until the row is pointed at or reached with the keyboard, so the keys stand out.
            !listening && keys.length > 0 && 'opacity-0 focus-visible:opacity-100 [[data-setting]:focus-within_&]:opacity-100 [[data-setting]:hover_&]:opacity-100'
          )}
        >
          {listening ? (
            'Press keys…'
          ) : (
            <>
              <Plus size={12} strokeWidth={2} /> Add
            </>
          )}
        </button>
        {changed && (
          <Button
            variant="ghost"
            aria-label={`Reset ${label}`}
            className="h-7 px-2 text-xs"
            onClick={() => {
              const { [id]: _gone, ...rest } = overrides
              update({ shortcuts: rest })
              setNote(null)
            }}
          >
            Reset
          </Button>
        )}
      </div>
    </Row>
  )
}

/** Every browser shortcut, by group, to change by pressing new keys. */
export function KeyboardPage({ settings, update }: { settings: Settings; update: Update }) {
  const [recording, setRecording] = useState<ShortcutId | null>(null)
  return (
    <>
      {SHORTCUT_GROUPS.map((group) => (
        <Section key={group} title={group} keywords="keyboard shortcuts keys hotkeys">
          {SHORTCUTS.filter((shortcut) => shortcut.group === group).map((shortcut) => (
            <ShortcutRow key={shortcut.id} id={shortcut.id} label={shortcut.label} settings={settings} update={update} recording={recording} setRecording={setRecording} />
          ))}
        </Section>
      ))}
      <Section title="Fixed keys" description="These can’t be changed." keywords="keyboard shortcuts">
        {FIXED_SHORTCUTS.map((fixed) => (
          <Row key={fixed.label} label={fixed.label}>
            <span className="text-xs text-text-muted">{platform() === 'darwin' ? fixed.keys.replace(/\bCtrl\b/g, '⌘').replace(/\bAlt\b/g, '⌥') : fixed.keys}</span>
          </Row>
        ))}
        <Row label="Reset every shortcut" hint="Puts back the keys scTerra comes with.">
          <Button variant="ghost" disabled={Object.keys(settings.shortcuts).length === 0} onClick={() => update({ shortcuts: {} })}>
            Reset all
          </Button>
        </Row>
      </Section>
    </>
  )
}
