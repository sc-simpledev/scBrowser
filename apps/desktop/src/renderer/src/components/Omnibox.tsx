import { BookOpen, Lock, Search, ShieldCheck, ShieldOff, Star, TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { cx, IconButton } from '@scbrowser/ui'
import {
  buildSuggestions,
  displayUrl,
  effectiveUrl,
  engineById,
  isReaderUrl,
  type AssistantEvent,
  type HistoryEntry,
  type OmniboxAnswer,
  type Suggestion
} from '@scbrowser/shared'
import { useApp } from '../state/app'
import { useAssistant } from '../state/assistant'
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
  const bookmarks = useApp((s) => s.bookmarks)
  const searchEngine = useApp((s) => s.settings.searchEngine)
  const assistantReady = useAssistant((s) => s.status.ready)
  const sources = useApp((s) => s.settings.suggestionSources)
  const protection = useApp((s) => s.settings.trackingProtection)
  const hidden = useApp((s) => s.settings.hiddenToolbarItems)
  const compact = useApp((s) => s.compact)
  const privacyOffHosts = useApp((s) => s.privacyOffHosts)
  const boxRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [focused, setFocused] = useState(false)
  const [draft, setDraft] = useState<string | null>(null)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [dismissed, setDismissed] = useState(false)
  const [answer, setAnswer] = useState<OmniboxAnswer | null>(null)
  const answerStream = useRef<string | null>(null)
  const saveChats = useApp((s) => s.settings.saveChats)

  const url = tab ? displayUrl(tab.url) : ''
  const bookmarked = bookmarks.some((b) => b.url === url)
  const protectionOff = !!tab && URL.canParse(tab.url) && privacyOffHosts.includes(new URL(tab.url).host)
  const value = draft ?? url
  const formatted = !focused && draft === null ? formatUrl(url) : null

  const { history, phrases } = useMatches(draft)
  const suggestions = useMemo(
    () =>
      draft === null
        ? []
        : buildSuggestions(draft, {
            history,
            bookmarks,
            tabs,
            activeTabId: tab?.id ?? null,
            searchSuggestions: phrases,
            engine: engineById(searchEngine),
            assistantReady,
            sources
          }),
    [draft, history, bookmarks, phrases, tabs, tab?.id, searchEngine, assistantReady, sources]
  )
  const open = !answer && focused && !dismissed && suggestions.length > 0
  const selected = Math.min(selectedIndex, Math.max(0, suggestions.length - 1))

  // Rows picked in the overlay arrive after this input has blurred, so keep the list in a ref.
  const suggestionsRef = useRef(suggestions)
  suggestionsRef.current = suggestions

  const reset = useCallback(() => {
    setDraft(null)
    setSelectedIndex(0)
    setDismissed(false)
  }, [])

  const closeAnswer = useCallback(() => {
    if (answerStream.current) void window.scb.invoke('ai:cancel', answerStream.current)
    answerStream.current = null
    setAnswer(null)
  }, [])

  /** Only runs once someone chooses to ask. Page text isn't included. */
  const ask = useCallback(
    (question: string) => {
      const streamId = crypto.randomUUID()
      answerStream.current = streamId
      setAnswer({ question, text: '', streaming: true, error: null, canContinue: saveChats })
      void window.scb.invoke('ai:send', streamId, { messages: [{ role: 'user', content: question }], tabId: null, extraTabIds: [], includePage: false, selection: null })
    },
    [saveChats]
  )

  useEffect(
    () =>
      window.scb.on('ai:event', (event: AssistantEvent) => {
        if (event.streamId !== answerStream.current) return
        if (event.type === 'text') setAnswer((current) => current && { ...current, text: current.text + event.text })
        if (event.type === 'error') setAnswer((current) => current && { ...current, streaming: false, error: event.message })
        if (event.type === 'done') setAnswer((current) => current && { ...current, streaming: false })
        if (event.type === 'error' || event.type === 'done') answerStream.current = null
      }),
    []
  )

  useEffect(
    () =>
      window.scb.on('omnibox:answer-action', (action) => {
        if (action === 'stop' && answerStream.current) void window.scb.invoke('ai:cancel', answerStream.current)
        if (action === 'close') closeAnswer()
        if (action === 'continue') {
          setAnswer((current) => {
            if (current) {
              const id = crypto.randomUUID()
              const turns = [
                { role: 'user' as const, content: current.question },
                { role: 'assistant' as const, content: current.text }
              ]
              void window.scb.invoke('chats:save', id, turns).then(() => window.scb.invoke('ai:open-chat', id))
            }
            return null
          })
        }
      }),
    [closeAnswer]
  )

  const run = useCallback(
    (suggestion: Suggestion | undefined) => {
      if (!tab || !suggestion) return
      const { action } = suggestion
      if (action.type === 'ask') {
        ask(action.text)
        reset()
        return
      }
      if (action.type === 'switch-tab') void window.scb.invoke('tabs:activate', action.tabId)
      else if (action.type === 'ask-page') void window.scb.invoke('ai:open-assistant', action.text)
      else void window.scb.invoke('tabs:navigate', tab.id, action.url)
      reset()
      inputRef.current?.blur()
    },
    [tab, reset, ask]
  )

  useEffect(() => window.scb.on('omnibox:pick', (index) => run(suggestionsRef.current[index])), [run])

  // Switching tabs discards an unsubmitted edit.
  useEffect(reset, [tab?.id, reset])
  useEffect(closeAnswer, [tab?.id, tab?.url, closeAnswer])

  useEffect(() => {
    if (focusRequest === 0) return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [focusRequest])

  // Describe the dropdown to the overlay, re-anchoring if the window is resized.
  useEffect(() => {
    if ((!open && !answer) || !boxRef.current) {
      setPopup(null)
      return
    }
    const box = boxRef.current
    const publish = () => {
      const { x, y, width, height } = box.getBoundingClientRect()
      setPopup({ anchor: { x, y, width, height }, suggestions: answer ? [] : suggestions, selectedIndex: selected, answer })
    }
    publish()
    window.addEventListener('resize', publish)
    return () => window.removeEventListener('resize', publish)
  }, [open, answer, suggestions, selected, setPopup])

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
      if (answer) closeAnswer()
      else if (open) setDismissed(true)
      else if (draft !== null) reset()
      else e.currentTarget.blur()
    }
  }

  return (
    <div
      ref={boxRef}
      className={cx(
        'sc-no-drag relative flex h-8 w-full min-w-0 flex-1 items-center gap-2 rounded-md px-2.5 transition-[background-color,box-shadow]',
        focused ? 'bg-surface shadow-[0_0_0_1px_var(--sc-accent)]' : 'bg-surface shadow-1 hover:shadow-[0_0_0_1px_var(--sc-border-strong)]'
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
      {tab && /^https?:/.test(tab.url) && protection !== 'off' && !hidden.includes('protection') && !compact && (
        <IconButton
          size="sm"
          label={protectionOff ? 'Tracking protection is off here' : `${tab.blockedCount} blocked. Turn off for this site`}
          className="w-auto min-w-6 gap-0.5 px-1"
          onClick={() => void window.scb.invoke('privacy:toggle-site', new URL(tab.url).host)}
        >
          {protectionOff ? <ShieldOff size={14} strokeWidth={1.75} /> : <ShieldCheck size={14} strokeWidth={1.75} />}
          {!protectionOff && tab.blockedCount > 0 && <span className="text-2xs font-medium">{tab.blockedCount}</span>}
        </IconButton>
      )}
      {tab && (/^https?:/.test(tab.url) || isReaderUrl(tab.url)) && !hidden.includes('reader') && !compact && (
        <IconButton
          size="sm"
          label={isReaderUrl(tab.url) ? 'Leave reader view' : 'Reader view'}
          shortcut="F9"
          aria-pressed={isReaderUrl(tab.url)}
          className={isReaderUrl(tab.url) ? 'text-accent' : undefined}
          onClick={() => void window.scb.invoke('reader:toggle')}
        >
          <BookOpen size={14} strokeWidth={1.75} />
        </IconButton>
      )}
      {tab && tab.zoomPercent !== 100 && (
        <button
          type="button"
          aria-label={`Zoom ${tab.zoomPercent}%, reset`}
          onClick={() => void window.scb.invoke('zoom:reset')}
          className="shrink-0 rounded-sm px-1.5 text-2xs font-medium text-text-muted hover:bg-surface-active hover:text-text"
        >
          {tab.zoomPercent}%
        </button>
      )}
      {tab && /^(https?|file):/.test(url) && !hidden.includes('bookmark') && (
        <IconButton
          size="sm"
          label={bookmarked ? 'Edit bookmark' : 'Bookmark this page'}
          shortcut="Ctrl D"
          aria-pressed={bookmarked}
          onClick={() => void window.scb.invoke('bookmarks:edit-page', effectiveUrl(tab.url), tab.title)}
        >
          <Star
            size={14}
            strokeWidth={1.75}
            className={bookmarked ? 'fill-accent text-accent' : undefined}
          />
        </IconButton>
      )}
    </div>
  )
}
