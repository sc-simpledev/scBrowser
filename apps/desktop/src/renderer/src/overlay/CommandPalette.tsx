import { useEffect, useMemo, useRef, useState } from 'react'
import { cx } from '@scbrowser/ui'
import { matchCommands, PALETTE_POPUP } from '@scbrowser/shared'

const ROW_HEIGHT = 36

export function CommandPalette({ x, y }: { x: number; y: number }) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const commands = useMemo(() => matchCommands(query), [query])

  const close = () => void window.scbOverlay.invoke('overlay:palette-close')
  const run = (id: string | undefined) => {
    if (id) void window.scbOverlay.invoke('overlay:palette-run', id)
  }

  useEffect(() => {
    inputRef.current?.focus()
    window.addEventListener('blur', close)
    return () => window.removeEventListener('blur', close)
  }, [])

  useEffect(() => {
    listRef.current?.scrollTo({ top: Math.max(0, (selected - 6) * ROW_HEIGHT) })
  }, [selected])

  return (
    <div
      role="dialog"
      aria-label="Command palette"
      className="absolute flex flex-col overflow-hidden rounded-lg bg-surface shadow-3"
      style={{ left: x, top: y, width: PALETTE_POPUP.width, height: PALETTE_POPUP.height }}
    >
      <input
        ref={inputRef}
        role="combobox"
        aria-expanded
        aria-label="Type a command"
        placeholder="Type a command"
        spellCheck={false}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setSelected(0)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') close()
          if (e.key === 'Enter') run(commands[selected]?.id)
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            if (commands.length > 0) {
              setSelected((selected + (e.key === 'ArrowDown' ? 1 : -1) + commands.length) % commands.length)
            }
          }
        }}
        className="h-11 shrink-0 border-b border-border bg-transparent px-3 text-md text-text outline-none placeholder:text-text-faint"
      />
      <ul ref={listRef} role="listbox" aria-label="Commands" className="min-h-0 flex-1 overflow-y-auto p-1">
        {commands.length === 0 && <li className="px-2.5 py-2 text-text-muted">No matching commands.</li>}
        {commands.map((command, index) => (
          <li
            key={command.id}
            role="option"
            aria-selected={index === selected}
            style={{ height: ROW_HEIGHT }}
            onMouseMove={() => setSelected(index)}
            onClick={() => run(command.id)}
            className={cx('flex items-center justify-between rounded-md px-2.5', index === selected && 'bg-accent-soft')}
          >
            {command.label}
            {command.shortcut && <kbd className="font-sans text-2xs text-text-faint">{command.shortcut}</kbd>}
          </li>
        ))}
      </ul>
    </div>
  )
}
