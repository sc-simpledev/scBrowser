import { Lock, Search, TriangleAlert } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { cx } from '@scbrowser/ui'
import { displayUrl } from '@scbrowser/shared'
import { useActiveTab, useTabs } from '../state/tabs'

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

export function Omnibox() {
  const tab = useActiveTab()
  const focusRequest = useTabs((s) => s.omniboxFocusRequest)
  const inputRef = useRef<HTMLInputElement>(null)
  const [focused, setFocused] = useState(false)
  const [draft, setDraft] = useState<string | null>(null)

  const url = tab ? displayUrl(tab.url) : ''
  const value = draft ?? url
  const formatted = !focused && draft === null ? formatUrl(url) : null

  // Switching tabs discards an unsubmitted edit.
  useEffect(() => setDraft(null), [tab?.id])

  useEffect(() => {
    if (focusRequest === 0) return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [focusRequest])

  const submit = () => {
    if (!tab || !value.trim()) return
    void window.scb.invoke('tabs:navigate', tab.id, value)
    setDraft(null)
    inputRef.current?.blur()
  }

  return (
    <div
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
          aria-label="Search or enter address"
          placeholder="Search or enter address"
          onChange={(e) => setDraft(e.target.value)}
          onFocus={(e) => {
            setFocused(true)
            e.currentTarget.select()
          }}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
            if (e.key === 'Escape') {
              if (draft !== null) setDraft(null)
              else e.currentTarget.blur()
            }
          }}
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
