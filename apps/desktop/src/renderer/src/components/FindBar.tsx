import { ChevronDown, ChevronUp, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { IconButton, Input } from '@scbrowser/ui'
import { useActiveTab } from '../state/tabs'

export function FindBar() {
  const tabId = useActiveTab()?.id
  const inputRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [focusRequest, setFocusRequest] = useState(0)
  const [result, setResult] = useState<{ active: number; total: number } | null>(null)

  const close = () => {
    setOpen(false)
    setResult(null)
    void window.scb.invoke('find:stop')
  }

  const search = (value: string, forward: boolean, findNext: boolean) => {
    if (!value) setResult(null)
    void window.scb.invoke('find:query', value, { forward, findNext })
  }
  const openWith = (words: string | null) => {
    setOpen(true)
    if (words) {
      setText(words)
      search(words, true, false)
    }
    setFocusRequest((n) => n + 1)
  }
  // Words found from Tab search arrive with their tab, which may not be the open one here yet.
  const tabRef = useRef(tabId)
  tabRef.current = tabId
  const pending = useRef<{ text: string; tabId: number } | null>(null)

  useEffect(
    () =>
      window.scb.on('ui:open-find', (request) => {
        if (request && request.tabId !== tabRef.current) pending.current = request
        else openWith(request?.text ?? null)
      }),
    []
  )
  useLayoutEffect(() => {
    if (focusRequest === 0) return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [focusRequest])
  useEffect(() => window.scb.on('find:result', setResult), [])
  useEffect(() => {
    setOpen(false)
    setResult(null)
    const waiting = pending.current
    if (waiting && waiting.tabId === tabId) {
      pending.current = null
      openWith(waiting.text)
    }
  }, [tabId])

  if (!open) return null
  return (
    <div role="search" className="flex h-9 shrink-0 items-center justify-end gap-1 px-2 pb-1">
      <Input
        ref={inputRef}
        aria-label="Find in page"
        placeholder="Find in page"
        className="w-60"
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          search(e.target.value, true, false)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') search(text, !e.shiftKey, true)
          if (e.key === 'Escape') close()
        }}
      />
      <span aria-live="polite" className="w-20 text-center text-xs text-text-faint tabular-nums">
        {result ? (result.total === 0 ? 'No matches' : `${result.active} of ${result.total}`) : ''}
      </span>
      <IconButton size="sm" label="Previous match" disabled={result?.total === 0} onClick={() => search(text, false, true)}>
        <ChevronUp size={14} strokeWidth={1.75} />
      </IconButton>
      <IconButton size="sm" label="Next match" disabled={result?.total === 0} onClick={() => search(text, true, true)}>
        <ChevronDown size={14} strokeWidth={1.75} />
      </IconButton>
      <IconButton size="sm" label="Close find bar" onClick={close}>
        <X size={14} strokeWidth={1.75} />
      </IconButton>
    </div>
  )
}
