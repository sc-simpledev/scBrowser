import { ChevronDown, ChevronUp, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { IconButton, Input } from '@scbrowser/ui'
import { useActiveTab } from '../state/tabs'

export function FindBar() {
  const tabId = useActiveTab()?.id
  const inputRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [result, setResult] = useState<{ active: number; total: number } | null>(null)

  const close = () => {
    setOpen(false)
    setResult(null)
    void window.scb.invoke('find:stop')
  }

  useEffect(
    () =>
      window.scb.on('ui:open-find', () => {
        setOpen(true)
        // The bar may not be mounted yet on first open.
        requestAnimationFrame(() => {
          inputRef.current?.focus()
          inputRef.current?.select()
        })
      }),
    []
  )
  useEffect(() => window.scb.on('find:result', setResult), [])
  useEffect(() => {
    setOpen(false)
    setResult(null)
  }, [tabId])

  const search = (value: string, forward: boolean, findNext: boolean) => {
    if (!value) setResult(null)
    void window.scb.invoke('find:query', value, { forward, findNext })
  }

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
      <span aria-live="polite" className="w-16 text-center text-xs text-text-faint">
        {result ? `${result.active} of ${result.total}` : ''}
      </span>
      <IconButton size="sm" label="Previous match" onClick={() => search(text, false, true)}>
        <ChevronUp size={14} strokeWidth={1.75} />
      </IconButton>
      <IconButton size="sm" label="Next match" onClick={() => search(text, true, true)}>
        <ChevronDown size={14} strokeWidth={1.75} />
      </IconButton>
      <IconButton size="sm" label="Close find bar" onClick={close}>
        <X size={14} strokeWidth={1.75} />
      </IconButton>
    </div>
  )
}
