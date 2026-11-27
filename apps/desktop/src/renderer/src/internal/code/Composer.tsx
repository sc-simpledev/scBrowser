import { ArrowUp, BookmarkPlus, Brain, Check, ChevronDown, FileText, Globe, ImagePlus, Square, SquareTerminal, X, type LucideIcon } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { cx, IconButton } from '@scbrowser/ui'
import { CODER_BUILTIN_COMMANDS, CODER_EFFORTS, CODER_MAX_IMAGES, type CoderEffort, type CoderExtension, type CoderMention, type CoderMode, type CoderModelChoice } from '@scbrowser/shared'
import { api } from '../api'
import { shortTokens, type ContextUse } from './codeState'

export const MODES: { id: CoderMode; label: string; hint: string }[] = [
  { id: 'plan', label: 'Plan', hint: 'It looks around and writes a plan. Nothing changes.' },
  { id: 'ask', label: 'Ask', hint: 'It asks before every change and command.' },
  { id: 'edits', label: 'Auto-edit', hint: 'It changes files without asking, and asks before every command.' },
  { id: 'auto', label: 'Auto', hint: 'It changes files and runs commands without asking. Risky commands (sudo, pushing, deleting outside the project, publishing) still ask.' }
]

export interface ModelPick {
  providerId: string
  providerName: string
  model: string
}

export interface SendPayload {
  text: string
  images: string[]
  mentions: CoderMention[]
}

interface MenuRow {
  key: string
  /** Files and tabs show what they are; commands need no icon, as they start with a slash. */
  icon?: LucideIcon
  label: string
  detail: string
  pick: () => void
}

/** Files bigger than this aren't worth sending to a model as a picture. */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const ARGLESS = new Set(CODER_BUILTIN_COMMANDS.filter((command) => !command.args).map((command) => command.name))

const readImage = (file: File) =>
  new Promise<string | null>((done) => {
    if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type) || file.size > MAX_IMAGE_BYTES) return done(null)
    const reader = new FileReader()
    reader.onload = () => done(typeof reader.result === 'string' ? reader.result : null)
    reader.onerror = () => done(null)
    reader.readAsDataURL(file)
  })

/** How full the model's memory is, as a small ring, with the session's use on hover. */
function ContextRing({ context }: { context: ContextUse }) {
  const share = Math.min(1, context.used / Math.max(1, context.limit))
  const r = 5.5
  const length = 2 * Math.PI * r
  const percent = Math.round(share * 100)
  const label = `Memory ${percent}% full (${shortTokens(context.used)} of ${shortTokens(context.limit)} tokens). This session has used ${shortTokens(context.inputTokens)} in and ${shortTokens(context.outputTokens)} out.`
  return (
    <span role="img" aria-label={label} title={label} className={cx('flex h-5 shrink-0 items-center gap-1 px-1 text-2xs tabular-nums', share > 0.8 ? 'text-danger' : 'text-text-faint')}>
      <svg viewBox="0 0 14 14" className="size-3 -rotate-90">
        <circle cx="7" cy="7" r={r} fill="none" strokeWidth="2" className="stroke-border-strong" />
        <circle cx="7" cy="7" r={r} fill="none" strokeWidth="2" strokeLinecap="round" strokeDasharray={`${share * length} ${length}`} className={share > 0.8 ? 'stroke-danger' : 'stroke-text-muted'} />
      </svg>
      {percent}%
    </span>
  )
}

/** Closes a popover like any menu: Escape, or a click anywhere else (the chip that opened it toggles it itself). */
function useDismiss(ref: RefObject<HTMLElement | null>, onClose: () => void) {
  useEffect(() => {
    const away = (event: MouseEvent) => !ref.current?.parentElement?.contains(event.target as Node) && onClose()
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      onClose()
    }
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', escape, true)
    return () => {
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', escape, true)
    }
  }, [ref, onClose])
}

/** The model for this session. */
function ModelMenu({ pick, onPick, onClose }: { pick: ModelPick | null; onPick: (pick: ModelPick | null) => void; onClose: () => void }) {
  const [choices, setChoices] = useState<CoderModelChoice[] | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    void api().invoke('coder:models').then(setChoices, () => setChoices([]))
  }, [])
  useDismiss(ref, onClose)
  const providers = [...new Set((choices ?? []).map((choice) => choice.providerName))]
  const same = (choice: CoderModelChoice) => pick?.providerId === choice.providerId && pick.model === choice.model
  return (
    <div ref={ref} role="dialog" aria-label="Model for this session" className="sc-glass-strong absolute bottom-full left-0 z-20 mb-1.5 flex max-h-80 w-72 flex-col overflow-hidden rounded-lg text-text shadow-3">
      <div className="sc-scroll-quiet min-h-0 flex-1 overflow-y-auto p-1">
        <button type="button" onClick={() => onPick(null)} className={cx('flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-xs', pick === null ? 'bg-accent-soft' : 'hover:bg-surface-hover')}>
          <span className="min-w-0 flex-1 truncate">Same as the assistant</span>
          {pick === null && <Check aria-hidden size={12} strokeWidth={2} className="shrink-0 text-accent" />}
        </button>
        {choices === null && <p className="px-2 py-1.5 text-xs text-text-faint">Finding models…</p>}
        {providers.map((provider) => (
          <div key={provider} role="group" aria-label={provider}>
            <p className="px-2 pt-2 pb-0.5 text-2xs font-medium text-text-faint">{provider}</p>
            {choices!
              .filter((choice) => choice.providerName === provider)
              .map((choice) => (
                <button key={`${choice.providerId}:${choice.model}`} type="button" onClick={() => onPick(choice)} className={cx('flex h-7 w-full items-center gap-2 rounded-md px-2 text-left font-mono text-2xs', same(choice) ? 'bg-accent-soft' : 'hover:bg-surface-hover')}>
                  <span className="min-w-0 flex-1 truncate">{choice.model}</span>
                  {same(choice) && <Check aria-hidden size={12} strokeWidth={2} className="shrink-0 text-accent" />}
                </button>
              ))}
          </div>
        ))}
      </div>
    </div>
  )
}

export const effortLabel = (effort: CoderEffort | null) => (effort ? (CODER_EFFORTS.find((option) => option.id === effort)?.label ?? effort) : 'Auto')

/** How hard the model thinks: five levels and Auto, each with what it's for. */
function EffortMenu({ effort, onPick, onClose }: { effort: CoderEffort | null; onPick: (effort: CoderEffort | null) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useDismiss(ref, onClose)
  const options: { id: CoderEffort | null; label: string; hint: string }[] = [{ id: null, label: 'Auto', hint: 'Medium for coding, or the model’s own default' }, ...CODER_EFFORTS]
  return (
    <div ref={ref} role="dialog" aria-label="Thinking" className="sc-glass-strong absolute bottom-full left-0 z-20 mb-1.5 flex w-72 flex-col rounded-lg p-1 text-text shadow-3">
      <p className="px-2 pt-1.5 pb-1 text-2xs text-text-faint">How hard the model thinks before acting. Higher is slower and uses more of your limit.</p>
      <div role="radiogroup" aria-label="Thinking level" className="flex flex-col">
        {options.map((option) => (
          <button key={option.label} type="button" role="radio" aria-checked={effort === option.id} onClick={() => onPick(option.id)} className={cx('flex min-h-9 w-full items-center gap-2.5 rounded-md px-2 py-1 text-left', effort === option.id ? 'bg-accent-soft' : 'hover:bg-surface-hover')}>
            <EffortBars effort={option.id} />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-xs">{option.label}</span>
              <span className="truncate text-2xs text-text-faint">{option.hint}</span>
            </span>
            {effort === option.id && <Check aria-hidden size={12} strokeWidth={2} className="shrink-0 text-accent" />}
          </button>
        ))}
      </div>
    </div>
  )
}

/** Five small bars, filled to the level. */
function EffortBars({ effort }: { effort: CoderEffort | null }) {
  const level = effort ? CODER_EFFORTS.findIndex((option) => option.id === effort) + 1 : 0
  return (
    <span aria-hidden className="flex h-3 shrink-0 items-end gap-px">
      {[1, 2, 3, 4, 5].map((bar) => (
        <span key={bar} className={cx('w-0.75 rounded-[1px]', bar <= level ? 'bg-accent' : 'bg-border-strong')} style={{ height: `${4 + bar * 1.6}px` }} />
      ))}
    </span>
  )
}

export interface ComposerProps {
  enabled: boolean
  ready: boolean
  working: boolean
  placeholder: string
  mode: CoderMode
  onMode: (mode: CoderMode) => void
  /** The project's own commands, and the person's. */
  commands: CoderExtension[]
  defaultModel: string | null
  model: ModelPick | null
  effort: CoderEffort | null
  onModel: (model: ModelPick | null) => void
  onEffort: (effort: CoderEffort | null) => void
  /** What was sent before in this session, newest last, for the up arrow. */
  history: string[]
  /** Opens the model menu when /model asks. */
  modelMenuRequest: number
  context: ContextUse | null
  /** Text to put back in the box, such as a rewound message. Changes when it should. */
  seed: { text: string; at: number } | null
  onSend: (payload: SendPayload) => void
  onStop: () => void
}

/** The box at the bottom: the message, with /commands, @files and @tabs, and pictures pasted in. */
export function Composer({ enabled, ready, working, placeholder, mode, onMode, commands, defaultModel, model, effort, onModel, onEffort, history, modelMenuRequest, context, seed, onSend, onStop }: ComposerProps) {
  const [draft, setDraft] = useState('')
  const [images, setImages] = useState<string[]>([])
  const [mentions, setMentions] = useState<{ token: string; mention: CoderMention }[]>([])
  const [caret, setCaret] = useState(0)
  const [selected, setSelected] = useState(0)
  const [dismissed, setDismissed] = useState(false)
  const [files, setFiles] = useState<string[]>([])
  const [tabs, setTabs] = useState<{ id: number; title: string; url: string }[] | null>(null)
  const [modelOpen, setModelOpen] = useState(false)
  const [effortOpen, setEffortOpen] = useState(false)
  /** How far back the up arrow has gone (0: not looking back), and what was typed before. */
  const [back, setBack] = useState(0)
  const typed = useRef('')
  const picker = useRef<HTMLInputElement>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const box = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!seed) return
    setDraft(seed.text)
    box.current?.focus()
  }, [seed])
  useEffect(() => {
    if (modelMenuRequest > 0) setModelOpen(true)
  }, [modelMenuRequest])

  // What's being typed right before the caret: a /command at the start, or an @mention anywhere.
  const before = draft.slice(0, caret)
  const slash = /^\/([\w.:-]*)$/.exec(before)?.[1] ?? null
  const at = /(?:^|\s)@([^\s@]*)$/.exec(before)?.[1] ?? null

  useEffect(() => {
    if (at === null || !enabled) return
    const timer = setTimeout(() => void api().invoke('coder:files', at).then(setFiles, () => setFiles([])), 80)
    if (tabs === null) void api().invoke('coder:tabs').then(setTabs, () => setTabs([]))
    return () => clearTimeout(timer)
  }, [at, enabled, tabs])

  const replaceToken = (insert: string, token: RegExp) => {
    const start = before.replace(token, '')
    const next = `${start}${insert}${draft.slice(caret)}`
    setDraft(next)
    const position = start.length + insert.length
    requestAnimationFrame(() => {
      box.current?.setSelectionRange(position, position)
      setCaret(position)
    })
  }

  const rows: MenuRow[] = useMemo(() => {
    if (dismissed) return []
    if (slash !== null) {
      const all = [...CODER_BUILTIN_COMMANDS.map((command) => ({ name: command.name, description: command.description, args: command.args ?? '' })), ...commands.map((command) => ({ name: command.name, description: command.description, args: '' }))]
      return all
        .filter((command) => command.name.toLowerCase().startsWith(slash.toLowerCase()))
        .slice(0, 12)
        .map((command) => ({
          key: `/${command.name}`,
          label: `/${command.name}${command.args ? ` ${command.args}` : ''}`,
          detail: command.description,
          pick: () => {
            if (ARGLESS.has(command.name) && CODER_BUILTIN_COMMANDS.some((builtin) => builtin.name === command.name)) {
              setDraft('')
              onSend({ text: `/${command.name}`, images: [], mentions: [] })
              return
            }
            replaceToken(`/${command.name} `, /\/[\w.:-]*$/)
          }
        }))
    }
    if (at !== null) {
      const wanted = at.toLowerCase().replace(/^tab:/, '')
      const fileRows = (at.startsWith('tab:') ? [] : files).slice(0, 8).map((path) => ({
        key: `file:${path}`,
        icon: FileText,
        label: path.split('/').at(-1)!,
        // A file at the top of the project needs no path beside its name.
        detail: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '',
        pick: () => {
          const token = `@${path}`
          setMentions((current) => [...current.filter((entry) => entry.token !== token), { token, mention: { kind: 'file', path } }])
          replaceToken(`${token} `, /@[^\s@]*$/)
        }
      }))
      const tabRows = (tabs ?? [])
        .filter((tab) => !wanted || tab.title.toLowerCase().includes(wanted) || tab.url.toLowerCase().includes(wanted))
        .slice(0, 5)
        .map((tab) => ({
          key: `tab:${tab.id}`,
          icon: Globe,
          label: tab.title || tab.url,
          detail: 'Tab',
          pick: () => {
            const token = `@tab:${(tab.title || 'page').replace(/\s+/g, '-').replace(/[^\w.-]/g, '').slice(0, 30) || 'page'}`
            setMentions((current) => [...current.filter((entry) => entry.token !== token), { token, mention: { kind: 'tab', tabId: tab.id } }])
            replaceToken(`${token} `, /@[^\s@]*$/)
          }
        }))
      return [...fileRows, ...tabRows]
    }
    return []
  }, [dismissed, slash, at, commands, files, tabs, before, draft, caret])

  const highlighted = Math.min(selected, Math.max(0, rows.length - 1))

  const addImages = async (list: File[]) => {
    const room = CODER_MAX_IMAGES - images.length
    const read = (await Promise.all(list.slice(0, Math.max(0, room)).map(readImage))).filter((url): url is string => !!url)
    if (list.length > room || read.length < Math.min(list.length, room)) setWarning(`Up to ${CODER_MAX_IMAGES} pictures, each under 5 MB, as PNG, JPEG, GIF or WebP.`)
    if (read.length) setImages((current) => [...current, ...read].slice(0, CODER_MAX_IMAGES))
  }

  const send = () => {
    const text = draft.trim()
    if ((!text && images.length === 0) || !enabled || !ready) return
    onSend({ text, images, mentions: mentions.filter((entry) => text.includes(entry.token)).map((entry) => entry.mention) })
    setDraft('')
    setImages([])
    setMentions([])
    setWarning(null)
    setBack(0)
  }

  /** Earlier messages with the up and down arrows, as in a terminal. */
  const recall = (step: 1 | -1) => {
    const next = Math.max(0, Math.min(history.length, back + step))
    if (next === back) return false
    if (back === 0) typed.current = draft
    setBack(next)
    const text = next === 0 ? typed.current : history[history.length - next]!
    setDraft(text)
    requestAnimationFrame(() => box.current?.setSelectionRange(text.length, text.length))
    return true
  }

  const closeEffort = useCallback(() => setEffortOpen(false), [])
  const closeModel = useCallback(() => setModelOpen(false), [])
  const modeInfo = MODES.find((candidate) => candidate.id === mode) ?? MODES[1]!
  const canSend = (!!draft.trim() || images.length > 0) && enabled && ready
  // `!` runs a command yourself and `# ` adds a line to TERRA.md, as in Claude Code.
  const special = draft.startsWith('!') ? 'shell' : draft.startsWith('# ') ? 'memory' : null

  return (
    <div className={cx('@container relative flex flex-col rounded-lg border bg-field', special === 'shell' ? 'border-text-muted' : special === 'memory' ? 'border-accent' : 'border-border focus-within:border-border-strong')}>
      {rows.length > 0 && (
        <ul role="listbox" aria-label={slash !== null ? 'Commands' : 'Files and tabs'} className="sc-glass-strong absolute inset-x-0 bottom-full z-20 mb-1.5 max-h-72 overflow-y-auto rounded-lg p-1 text-text shadow-3">
          {rows.map((row, index) => (
            <li
              key={row.key}
              role="option"
              aria-selected={index === highlighted}
              onMouseDown={(e) => {
                e.preventDefault()
                row.pick()
              }}
              onMouseEnter={() => setSelected(index)}
              className={cx('flex h-8 cursor-default items-center gap-2.5 rounded-md px-2 text-xs', index === highlighted ? 'bg-accent-soft' : 'hover:bg-surface-hover')}
            >
              {row.icon && <row.icon aria-hidden size={13} strokeWidth={1.75} className={cx('shrink-0', index === highlighted ? 'text-accent' : 'text-text-faint')} />}
              <span title={row.label} className={cx('shrink-0 truncate font-mono text-2xs', !row.icon && 'w-32', index === highlighted && 'text-accent')}>{row.label}</span>
              <span className="min-w-0 flex-1 truncate text-text-faint">{row.detail}</span>
            </li>
          ))}
        </ul>
      )}
      {images.length > 0 && (
        <div className="flex gap-1.5 px-2.5 pt-2.5">
          {images.map((url, index) => (
            <div key={index} className="group relative size-12 shrink-0 overflow-hidden rounded-md border border-border">
              <img src={url} alt={`Picture ${index + 1}`} className="size-full object-cover" />
              <button type="button" aria-label={`Remove picture ${index + 1}`} onClick={() => setImages((current) => current.filter((_, i) => i !== index))} className="absolute top-0.5 right-0.5 grid size-4 place-items-center rounded-sm bg-surface/90 text-text opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100">
                <X size={10} strokeWidth={2.25} />
              </button>
            </div>
          ))}
        </div>
      )}
      {warning && <p className="px-3 pt-2 text-2xs text-danger">{warning}</p>}
      {special && (
        <p role="status" className={cx('flex items-center gap-1.5 px-3 pt-2 text-2xs', special === 'shell' ? 'text-text-muted' : 'text-accent')}>
          {special === 'shell' ? <SquareTerminal aria-hidden size={11} strokeWidth={1.75} /> : <BookmarkPlus aria-hidden size={11} strokeWidth={1.75} />}
          {special === 'shell' ? 'Command: runs in your project folder now, and Terra Code sees what it printed' : 'Memory: Enter adds this line to TERRA.md, read at the start of every session'}
        </p>
      )}
      <textarea
        ref={box}
        aria-label="Describe a change"
        value={draft}
        disabled={!enabled}
        placeholder={placeholder}
        onChange={(e) => {
          setDraft(e.target.value)
          setBack(0)
          setCaret(e.target.selectionStart)
          setSelected(0)
          setDismissed(false)
        }}
        onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
        onPaste={(e) => {
          const pictures = [...e.clipboardData.files].filter((file) => file.type.startsWith('image/'))
          if (pictures.length === 0) return
          e.preventDefault()
          void addImages(pictures)
        }}
        onDragOver={(e) => {
          if ([...e.dataTransfer.items].some((item) => item.type.startsWith('image/'))) e.preventDefault()
        }}
        onDrop={(e) => {
          const pictures = [...e.dataTransfer.files].filter((file) => file.type.startsWith('image/'))
          if (pictures.length === 0) return
          e.preventDefault()
          void addImages(pictures)
        }}
        onKeyDown={(e) => {
          if (rows.length > 0) {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault()
              setSelected((highlighted + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length)
              return
            }
            // A command typed out in full goes with Enter; Tab (or Enter on a part of one) completes it.
            const typedInFull = slash !== null && rows[highlighted]!.key.toLowerCase() === `/${slash.toLowerCase()}`
            if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey && !typedInFull)) {
              e.preventDefault()
              rows[highlighted]!.pick()
              return
            }
            if (e.key === 'Escape') {
              e.preventDefault()
              setDismissed(true)
              return
            }
          }
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            send()
            return
          }
          // Shift+Tab steps through Plan, Ask and Auto-edit, as in other coding agents.
          if (e.key === 'Tab' && e.shiftKey) {
            e.preventDefault()
            const at = MODES.findIndex((option) => option.id === mode)
            onMode(MODES[(at + 1) % MODES.length]!.id)
            return
          }
          if (e.key === 'Escape' && working) {
            e.preventDefault()
            onStop()
            return
          }
          const field = e.currentTarget
          const onFirstLine = !field.value.slice(0, field.selectionStart).includes('\n')
          const onLastLine = !field.value.slice(field.selectionEnd).includes('\n')
          if (e.key === 'ArrowUp' && onFirstLine && (draft === '' || back > 0) && recall(1)) e.preventDefault()
          else if (e.key === 'ArrowDown' && onLastLine && back > 0 && recall(-1)) e.preventDefault()
        }}
        className={cx('max-h-48 min-h-11 resize-none bg-transparent px-3 pt-2.5 pb-1 text-text outline-none [field-sizing:content] placeholder:text-text-faint', special === 'shell' ? 'font-mono text-xs leading-5' : 'text-sm')}
      />
      <div className="flex items-center gap-1.5 p-1.5">
        <div role="radiogroup" aria-label="Changes" className="flex shrink-0 items-center rounded-md bg-surface-hover p-0.5">
          {MODES.map((option) => (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={mode === option.id}
              title={`${option.hint} Shift+Tab switches.`}
              onClick={() => onMode(option.id)}
              className={cx('h-5.5 rounded-sm px-2 text-2xs font-medium transition-colors @max-[380px]:px-1.5', mode === option.id ? 'bg-surface text-text shadow-(--sc-shadow-1)' : 'text-text-muted hover:text-text')}
            >
              {option.label}
            </button>
          ))}
        </div>
        <span aria-hidden className="mx-0.5 h-4 w-px shrink-0 bg-border @max-[420px]:hidden" />
        <div className="relative min-w-0">
          <button
            type="button"
            aria-haspopup="dialog"
            aria-expanded={modelOpen}
            title={`${modeInfo.hint} Commands you allow run with your own permissions.`}
            onClick={() => (setModelOpen(!modelOpen), setEffortOpen(false))}
            className="flex h-6 max-w-48 min-w-0 items-center gap-1 rounded-md px-1.5 text-2xs text-text-muted transition-colors hover:bg-surface-hover hover:text-text"
          >
            <span className="min-w-0 truncate">{model?.model ?? defaultModel ?? 'Model'}</span>
            <ChevronDown aria-hidden size={11} strokeWidth={1.75} className="shrink-0 text-text-faint" />
          </button>
          {modelOpen && (
            <ModelMenu
              pick={model}
              onClose={closeModel}
              onPick={(next) => {
                onModel(next)
                setModelOpen(false)
              }}
            />
          )}
        </div>
        <div className="relative shrink-0">
          <button
            type="button"
            aria-haspopup="dialog"
            aria-expanded={effortOpen}
            aria-label={`Thinking: ${effortLabel(effort)}`}
            title="How hard the model thinks"
            onClick={() => (setEffortOpen(!effortOpen), setModelOpen(false))}
            className={cx('flex h-6 items-center gap-1.5 rounded-md px-1.5 text-2xs transition-colors hover:bg-surface-hover hover:text-text', effort ? 'text-text-muted' : 'text-text-faint')}
          >
            <Brain aria-hidden size={12} strokeWidth={1.75} className="shrink-0" />
            <span className="@max-[480px]:hidden">{effortLabel(effort)}</span>
          </button>
          {effortOpen && (
            <EffortMenu
              effort={effort}
              onClose={closeEffort}
              onPick={(next) => {
                onEffort(next)
                setEffortOpen(false)
              }}
            />
          )}
        </div>
        <span className="min-w-0 flex-1" />
        {/* Only once it's worth knowing; the summary takes over when it fills. */}
        {context && context.used / Math.max(1, context.limit) >= 0.1 && <ContextRing context={context} />}
        <input
          ref={picker}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          multiple
          hidden
          onChange={(e) => {
            const files = [...(e.target.files ?? [])]
            e.target.value = ''
            if (files.length) void addImages(files)
          }}
        />
        <IconButton size="sm" label="Attach a picture" className="@max-[340px]:hidden" disabled={!enabled || images.length >= CODER_MAX_IMAGES} onClick={() => picker.current?.click()}>
          <ImagePlus size={14} strokeWidth={1.75} />
        </IconButton>
        {working && draft.trim() && (
          <IconButton size="sm" label="Send to Terra Code" className="bg-text! text-surface! hover:opacity-85" onClick={send}>
            <ArrowUp size={14} strokeWidth={2} />
          </IconButton>
        )}
        {working ? (
          <IconButton size="sm" label="Stop" shortcut="Esc" onClick={onStop} className="bg-surface-hover! text-text!">
            <Square size={11} strokeWidth={2} className="fill-current" />
          </IconButton>
        ) : (
          <IconButton size="sm" label="Send" disabled={!canSend} className={canSend ? 'bg-text! text-surface! hover:opacity-85' : ''} onClick={send}>
            <ArrowUp size={14} strokeWidth={2} />
          </IconButton>
        )}
      </div>
    </div>
  )
}
