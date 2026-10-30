import { Lock, Search, TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { cx } from '@scbrowser/ui'
import { buildSuggestions, displayUrl, type HistoryEntry, type Suggestion } from '@scbrowser/shared'
import { useOverlay } from '../state/overlay'
import { useActiveTab, useTabs } from '../state/tabs'

const SEARCH_SUGGESTION_DELAY_MS = 120

/** Splits a URL so the host can be emphasised and the rest de-emphasised. */
function formatUrl(url: string): { prefix: string; host: string; rest: string } | null {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    const rest = url.slice(url.indexOf(parsed.host) + parsed.host.length)
    return { prefix: parsed.protocol === 'http:' ? 'http://' : '', host: parsed.host, rest: rest === '/' ? '' : rest }
  } catch {
    return null
  }
}

function SecurityIcon({ url, editing }: { url: string; editing: boolean }) {
  const props = { size: 14, strokeWidth: 1.75, 'aria-hidden': true } as const
  if (editing || !url) return <Search {...props} className="text-text-faint" />
  if (url.startsWith('https:')) return <Lock {...props} className="text-text-faint" />
  if (url.startsWith('http:')) return <TriangleAlert {...props} className="text-danger" />
  return <Search {...props} className="text-text-faint" />
}

/** History and search-engine matches for the current draft; stale responses are dropped. */
function useMatches(draft: string | null) {
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [phrases, setPhrases] = useState<string[]>([])

  useEffect(() => {
    const query = draft?.trim() ?? ''
    if (!query) {
      setHistory([])
      setPhrases([])
      return
    }
    let current = true
    void window.scb.invoke('history:search', query).then((entries) => current && setHistory(entries))
    const timer = setTimeout(() => {
      void window.scb.invoke('search:suggestions', query).then((list) => current && setPhrases(list))
    }, SEARCH_SUGGESTION_DELAY_MS)
    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [draft])

  return { history, phrases }
}

export function Omnibox() {
  const tab = useActiveTab()
  const tabs = useTabs((s) => s.tabs)
  const focusRequest = useTabs((s) => s.omniboxFocusRequest)
  const setPopup = useOverlay((s) => s.setOmnibox)
  const boxRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [focused, setFocused] = useState(false)
  const [draft, setDraft] = useState<string | null>(null)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [dismissed, setDismissed] = useState(false)

  const url = tab ? displayUrl(tab.url) : ''
  const value = draft ?? url
  const formatted = !focused && draft === null ? formatUrl(url) : null

  const { history, phrases } = useMatches(draft)
  const suggestions = useMemo(
    () =>
      draft === null
        ? []
        : buildSuggestions(draft, { history, tabs, activeTabId: tab?.id ?? null, searchSuggestions: phrases }),
    [draft, history, phrases, tabs, tab?.id]
  )
  const open = focused && !dismissed && suggestions.length > 0
  const selected = Math.min(selectedIndex, Math.max(0, suggestions.length - 1))

  // Rows picked in the overlay arrive after this input has blurred, so keep the list in a ref.
  const suggestionsRef = useRef(suggestions)
  suggestionsRef.current = suggestions

  const reset = useCallback(() => {
    setDraft(null)
    setSelectedIndex(0)
    setDismissed(false)
  }, [])

  const run = useCallback(
    (suggestion: Suggestion | undefined) => {
      if (!tab || !suggestion) return
      if (suggestion.action.type === 'switch-tab') void window.scb.invoke('tabs:activate', suggestion.action.tabId)
      else void window.scb.invoke('tabs:navigate', tab.id, suggestion.action.url)
      reset()
      inputRef.current?.blur()
    },
    [tab, reset]
  )

  useEffect(() => window.scb.on('omnibox:pick', (index) => run(suggestionsRef.current[index])), [run])

  // Switching tabs discards an unsubmitted edit.
  useEffect(reset, [tab?.id, reset])

  useEffect(() => {
    if (focusRequest === 0) return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [focusRequest])

  // Describe the dropdown to the overlay, re-anchoring if the window is resized.
  useEffect(() => {
    if (!open || !boxRef.current) {
      setPopup(null)
      return
    }
    const box = boxRef.current
    const publish = () => {
      const { x, y, width, height } = box.getBoundingClientRect()
      setPopup({ anchor: { x, y, width, height }, suggestions, selectedIndex: selected })
    }
    publish()
    window.addEventListener('resize', publish)
    return () => window.removeEventListener('resize', publish)
  }, [open, suggestions, selected, setPopup])

  useEffect(() => () => setPopup(null), [setPopup])

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!open) return
      e.preventDefault()
      const step = e.key === 'ArrowDown' ? 1 : -1
      setSelectedIndex((selected + step + suggestions.length) % suggestions.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (open) run(suggestions[selected])
      else if (tab && value.trim()) {
        void window.scb.invoke('tabs:navigate', tab.id, value)
        reset()
        e.currentTarget.blur()
      }
    } else if (e.key === 'Escape') {
      // First Escape closes the dropdown, the next restores the page's URL, then blur.
      if (open) setDismissed(true)
      else if (draft !== null) reset()
      else e.currentTarget.blur()
    }
  }

  return (
    <div
      ref={boxRef}
      className={cx(
        'sc-no-drag relative flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-2.5 transition-[background-color,box-shadow]',
        focused ? 'bg-surface shadow-[0_0_0_2px_var(--sc-focus-ring)]' : 'bg-field hover:bg-surface-hover'
      )}
      onMouseDown={(e) => {
        if (e.target !== inputRef.current) {
          e.preventDefault()
          inputRef.current?.focus()
        }
      }}
    >
      <SecurityIcon url={url} editing={focused && draft !== null} />
      <div className="relative min-w-0 flex-1">
        <input
          ref={inputRef}
          value={value}
          spellCheck={false}
          autoComplete="off"
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          aria-label="Search or enter address"
          placeholder="Search or enter address"
          onChange={(e) => {
            setDraft(e.target.value)
            setSelectedIndex(0)
            setDismissed(false)
          }}
          onFocus={(e) => {
            setFocused(true)
            e.currentTarget.select()
          }}
          onBlur={() => setFocused(false)}
          onKeyDown={onKeyDown}
          className={cx(
            'w-full bg-transparent text-sm text-text outline-none placeholder:text-text-faint',
            formatted && 'text-transparent'
          )}
        />
        {formatted && (
          <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center truncate text-sm">
            {formatted.prefix && <span className="text-danger">{formatted.prefix}</span>}
            <span className="text-text">{formatted.host}</span>
            <span className="truncate text-text-faint">{formatted.rest}</span>
          </div>
        )}
      </div>
    </div>
  )
}
