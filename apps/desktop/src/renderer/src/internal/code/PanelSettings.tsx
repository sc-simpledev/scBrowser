import { Check, ChevronRight, LogIn, LogOut, Pencil, Plus, RotateCw, Trash2, X, type LucideIcon } from 'lucide-react'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Button, cx, IconButton, Input, Segmented, Switch } from '@scbrowser/ui'
import { CODER_BUDGETS, CODER_EFFORTS, MCP_DIRECTORY, type CoderEffort, type McpDirectoryEntry, type CoderExtension, type CoderMode, type CoderModelChoice, type CoderSetup, type McpServerConfig, type McpServerView, type Settings } from '@scbrowser/shared'
import { api } from '../api'
import { MODES, type ModelPick } from './Composer'
import { GithubSettings, githubLabel, type useGithubStatus } from './GithubSettings'
import { AutomationsSettings, type AutomationsState } from './AutomationsSettings'

export const budgetLabel = (budget: number) => (budget === 0 ? 'No limit' : budget >= 1_000_000 ? `${budget / 1_000_000}M tokens` : `${budget / 1000}k tokens`)

const cleanError = (message: string) => message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/**
 * A setting as one line, with what it's set to on the right. Clicking it opens its choices just
 * below, in the sidebar itself; clicking again (or another) closes it.
 */
export function SettingRow({ icon: Icon, label, value, open, onToggle, children, mono = false }: { icon?: LucideIcon; label: ReactNode; value?: ReactNode; open: boolean; onToggle: () => void; children: ReactNode; mono?: boolean }) {
  return (
    <div className="flex flex-col">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className={cx('-mx-1 flex h-7 min-w-0 items-center gap-2 rounded-md px-1 text-left text-xs transition-colors hover:bg-surface-hover', open && 'bg-surface-hover')}
      >
        {Icon && <Icon aria-hidden size={13} strokeWidth={1.75} className="shrink-0 text-text-faint" />}
        <span className={cx('min-w-0 flex-1 truncate', mono && 'font-mono text-2xs')}>{label}</span>
        {value !== undefined && <span className="max-w-[55%] shrink-0 truncate text-text-muted">{value}</span>}
        <ChevronRight aria-hidden size={12} strokeWidth={1.75} className={cx('shrink-0 text-text-faint transition-transform duration-(--sc-duration-fast)', open && 'rotate-90')} />
      </button>
      {open && <div className="mt-1 mb-1.5 flex flex-col gap-2 border-l-2 border-border pl-3">{children}</div>}
    </div>
  )
}

/** A switch on one line, with a word on what it does underneath. */
export function SwitchRow({ label, hint, checked, onChange, disabled }: { label: string; hint?: string; checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean }) {
  return (
    <div className="flex min-h-7 items-center gap-2">
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-xs">{label}</span>
        {hint && <span className="text-2xs text-text-faint">{hint}</span>}
      </span>
      <Switch label={label} checked={checked} disabled={disabled} onChange={onChange} />
    </div>
  )
}

/** One of a few, as a short list: the chosen one ticked, each with a word on what it means. */
export function Choices<T extends string | null>({ label, value, options, onChange }: { label: string; value: T; options: { id: T; label: string; hint?: string; disabled?: boolean }[]; onChange: (value: T) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="-mx-1 flex flex-col">
      {options.map((option) => (
        <button
          key={String(option.id)}
          type="button"
          role="radio"
          aria-checked={value === option.id}
          disabled={option.disabled}
          onClick={() => onChange(option.id)}
          className={cx('flex min-w-0 items-start gap-2 rounded-md px-1 py-1 text-left transition-colors enabled:hover:bg-surface-hover disabled:opacity-50', value === option.id && 'bg-accent-soft/60')}
        >
          <span className="flex min-w-0 flex-1 flex-col">
            <span className={cx('text-xs', value === option.id && 'font-medium')}>{option.label}</span>
            {option.hint && <span className="text-2xs text-text-faint">{option.hint}</span>}
          </span>
          {value === option.id && <Check aria-hidden size={12} strokeWidth={2} className="mt-0.5 shrink-0 text-accent" />}
        </button>
      ))}
    </div>
  )
}

export const ModeChoices = ({ mode, onMode }: { mode: CoderMode; onMode: (mode: CoderMode) => void }) => <Choices label="Permissions" value={mode} options={MODES.map((option) => ({ id: option.id, label: option.label, hint: option.hint }))} onChange={onMode} />

export const EffortChoices = ({ effort, onEffort }: { effort: CoderEffort | null; onEffort: (effort: CoderEffort | null) => void }) => (
  <Choices<CoderEffort | null> label="Thinking" value={effort} options={[{ id: null, label: 'Auto', hint: 'Medium for coding, Low for quick look-ups' }, ...CODER_EFFORTS.map((option) => ({ id: option.id, label: option.label, hint: option.hint }))]} onChange={onEffort} />
)

/** The sandbox setting in words. */
export const sandboxLabel = (value: Settings['coderSandbox'], available: boolean, container: boolean) =>
  value === 'container' ? (container ? 'Dev container' : 'Off') : !available || value === 'off' ? 'Off' : value === 'project' ? 'Project only' : 'No network'

export function SandboxChoices({ value, available, container = false, onChange }: { value: Settings['coderSandbox']; available: boolean; container?: boolean; onChange: (value: Settings['coderSandbox']) => void }) {
  return (
    <>
      <Choices
        label="Sandbox"
        value={value === 'container' ? value : available ? value : 'off'}
        onChange={onChange}
        options={[
          { id: 'off', label: 'Off', hint: 'Commands run as you, anywhere you can' },
          { id: 'project', label: 'Project only', hint: 'They can only write in the project and build caches', disabled: !available },
          { id: 'offline', label: 'No network', hint: 'Project only, and cut off from the internet', disabled: !available },
          { id: 'container', label: 'Dev container', hint: 'Inside the project’s own dev container', disabled: !container && value !== 'container' }
        ]}
      />
      {!available && <p className="text-2xs text-text-faint">Project only and No network need bubblewrap on Linux, or a Mac.</p>}
      {!container && <p className="text-2xs text-text-faint">Dev container needs a .devcontainer in the project and the devcontainer CLI.</p>}
    </>
  )
}

/** Every model that's set up, to pick one for this session. */
export function ModelChoices({ model, onModel }: { model: ModelPick | null; onModel: (model: ModelPick | null) => void }) {
  const [choices, setChoices] = useState<CoderModelChoice[] | null>(null)
  useEffect(() => {
    void api().invoke('coder:models').then(setChoices, () => setChoices([]))
  }, [])
  const providers = [...new Set((choices ?? []).map((choice) => choice.providerName))]
  return (
    <div className="flex flex-col gap-1">
      <Choices<string | null> label="Model" value={model ? null : 'same'} options={[{ id: 'same', label: 'Same as the assistant' }]} onChange={() => onModel(null)} />
      {choices === null && <p className="text-2xs text-text-faint">Finding models…</p>}
      {providers.map((provider) => (
        <div key={provider} role="group" aria-label={provider} className="flex flex-col">
          <p className="pt-1 text-2xs font-medium text-text-faint">{provider}</p>
          <Choices<string>
            label={provider}
            value={model && model.providerName === provider ? `${model.providerId}:${model.model}` : ''}
            options={choices!.filter((choice) => choice.providerName === provider).map((choice) => ({ id: `${choice.providerId}:${choice.model}`, label: choice.model }))}
            onChange={(id) => {
              const choice = choices!.find((candidate) => `${candidate.providerId}:${candidate.model}` === id)
              if (choice) onModel(choice)
            }}
          />
        </div>
      ))}
    </div>
  )
}

/** Rules as a list to remove from, with a box to add one. */
function RuleList({ label, rules, placeholder, onChange }: { label: string; rules: string[]; placeholder: string; onChange: (rules: string[]) => void }) {
  const [adding, setAdding] = useState('')
  const add = () => {
    const rule = adding.trim()
    if (rule && !rules.includes(rule)) onChange([...rules, rule])
    setAdding('')
  }
  return (
    <div className="flex flex-col gap-1.5">
      {rules.length > 0 && (
        <ul aria-label={label} className="-mx-1 flex flex-col">
          {rules.map((rule) => (
            <li key={rule} className="group flex h-6.5 items-center gap-2 rounded-md px-1 hover:bg-surface-hover">
              <code className="min-w-0 flex-1 truncate font-mono text-2xs">{rule}</code>
              <IconButton size="sm" label={`Remove ${rule}`} className="size-5! opacity-0 group-hover:opacity-100 focus-visible:opacity-100" onClick={() => onChange(rules.filter((other) => other !== rule))}>
                <X size={11} strokeWidth={1.75} />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex gap-1"
        onSubmit={(e) => {
          e.preventDefault()
          add()
        }}
      >
        <Input aria-label={`Add to ${label.toLowerCase()}`} value={adding} placeholder={placeholder} onChange={(e) => setAdding(e.target.value)} className="h-7 min-w-0 flex-1 font-mono text-2xs" />
        <Button type="submit" disabled={!adding.trim()}>
          Add
        </Button>
      </form>
    </div>
  )
}

const STATE_COLOURS: Record<McpServerView['state'], string> = { ready: 'bg-success', starting: 'bg-accent', error: 'bg-danger', off: 'bg-border-strong', signin: 'bg-accent' }
const STATE_WORDS: Record<McpServerView['state'], string> = { ready: 'Running', starting: 'Starting', error: 'Not working', off: 'Starts when Terra Code needs it', signin: 'Needs you to sign in' }

/** Splits a command line into words, keeping quoted parts together. */
const words = (line: string) => [...line.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((match) => match[1] ?? match[2] ?? match[3]!)

const pairs = (text: string) =>
  Object.fromEntries(
    text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const at = line.search(/[=:]/)
        return at > 0 ? [line.slice(0, at).trim(), line.slice(at + 1).trim()] : [line, '']
      })
  )

/** A new server, or one of the person's own changed. Secret values left empty keep what's saved. */
function ServerForm({ editing, initial, onDone }: { editing: McpServerView | null; initial?: McpDirectoryEntry; onDone: () => void }) {
  const [name, setName] = useState(editing?.name ?? initial?.name ?? '')
  const [type, setType] = useState<'stdio' | 'http'>(editing?.type ?? initial?.config.type ?? 'stdio')
  const [target, setTarget] = useState(editing?.target ?? (initial ? directoryTarget(initial) : ''))
  const [secrets, setSecrets] = useState(editing ? editing.envKeys.map((key) => `${key}=`).join('\n') : initial ? initial.keys.map((key) => `${key.name}${initial.config.type === 'http' ? ': ' : '='}`).join('\n') : '')
  const [error, setError] = useState<string | null>(null)
  const save = () => {
    setError(null)
    const values = pairs(secrets)
    const server: McpServerConfig = type === 'stdio' ? { name: name.trim(), type, command: words(target)[0] ?? '', args: words(target).slice(1), env: values, enabled: editing?.enabled ?? true } : { name: name.trim(), type, url: target.trim(), headers: values, enabled: editing?.enabled ?? true }
    void api().invoke('coder:mcp-save', server).then(onDone, (failure: Error) => setError(cleanError(failure.message)))
  }
  return (
    <div role="group" aria-label={editing ? `Change ${editing.name}` : 'Add an MCP server'} className="flex flex-col gap-1.5 rounded-lg border border-border bg-surface p-2">
      <Input aria-label="Server name" value={name} disabled={!!editing} placeholder="Name, such as github" onChange={(e) => setName(e.target.value)} className="h-7 text-xs" />
      <Segmented
        label="How it runs"
        size="sm"
        value={type}
        onChange={setType}
        options={[
          ['stdio', 'A command'],
          ['http', 'An address']
        ]}
      />
      <Input aria-label={type === 'stdio' ? 'Command' : 'Address'} value={target} placeholder={type === 'stdio' ? 'npx -y @modelcontextprotocol/server-github' : 'https://example.com/mcp'} onChange={(e) => setTarget(e.target.value)} className="h-7 font-mono text-2xs" />
      <textarea
        aria-label={type === 'stdio' ? 'Environment variables' : 'Headers'}
        value={secrets}
        placeholder={type === 'stdio' ? 'TOKEN=…  one per line, kept encrypted' : 'Authorization: Bearer …  one per line'}
        onChange={(e) => setSecrets(e.target.value)}
        rows={2}
        className="resize-none rounded-md border border-border bg-field px-2 py-1.5 font-mono text-2xs outline-none placeholder:text-text-faint focus:border-border-strong"
      />
      {editing && <p className="text-2xs text-text-faint">Leave a value empty to keep the one saved.</p>}
      {initial?.keys.map((key) => (
        <p key={key.name} className="text-2xs text-text-faint">
          <code className="font-mono">{key.name}</code>: {key.hint}
        </p>
      ))}
      {error && <p className="text-2xs text-danger">{error}</p>}
      <div className="flex justify-end gap-1">
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button variant="primary" disabled={!name.trim() || !target.trim()} onClick={save}>
          Save
        </Button>
      </div>
    </div>
  )
}

/** Turning a server off keeps its settings; the form isn't needed for that. */
const toggleServer = (server: McpServerView) =>
  api().invoke(
    'coder:mcp-save',
    server.type === 'stdio'
      ? { name: server.name, type: 'stdio', command: words(server.target)[0] ?? '', args: words(server.target).slice(1), env: Object.fromEntries(server.envKeys.map((key) => [key, ''])), enabled: !server.enabled }
      : { name: server.name, type: 'http', url: server.target, headers: Object.fromEntries(server.envKeys.map((key) => [key, ''])), enabled: !server.enabled }
  )

/** A directory entry as the command line or address the form shows. */
const directoryTarget = (entry: McpDirectoryEntry) => (entry.config.type === 'stdio' ? [entry.config.command, ...entry.config.args].join(' ') : entry.config.url)

function ServerRow({ server, onChange, onEdit }: { server: McpServerView; onChange: () => void; onEdit: () => void }) {
  const [signing, setSigning] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const act = (promise: Promise<unknown>) => void promise.then(onChange, onChange)
  const own = server.source === 'global'
  const signIn = () => {
    setSigning(true)
    setProblem(null)
    void api()
      .invoke('coder:mcp-signin', server.name)
      .then(
        () => onChange(),
        (failure: Error) => setProblem(cleanError(failure.message))
      )
      .finally(() => setSigning(false))
  }
  return (
    <li className="group -mx-1 flex flex-col gap-0.5 rounded-md px-1 py-1 hover:bg-surface-hover">
      <div className="flex min-w-0 items-center gap-2">
        <span role="img" aria-label={STATE_WORDS[server.state]} title={STATE_WORDS[server.state]} className={cx('size-1.5 shrink-0 rounded-full', STATE_COLOURS[server.state])} />
        <span className="min-w-0 truncate text-xs font-medium">{server.name}</span>
        {!own && <span className="shrink-0 text-2xs text-text-faint">project</span>}
        <span className="min-w-0 flex-1" />
        {server.tools.length > 0 && <span className="shrink-0 text-2xs text-text-faint tabular-nums">{server.tools.length} tools</span>}
        {server.state === 'signin' && (
          <Button disabled={signing} onClick={signIn}>
            <LogIn aria-hidden size={12} strokeWidth={1.75} />
            {signing ? 'Waiting…' : 'Sign in'}
          </Button>
        )}
        {own ? (
          <Switch label={`Use ${server.name}`} checked={server.enabled} onChange={() => act(toggleServer(server))} />
        ) : server.trusted ? (
          <Button variant="ghost" onClick={() => act(api().invoke('coder:mcp-trust', server.name, false))}>
            Stop
          </Button>
        ) : (
          <Button onClick={() => act(api().invoke('coder:mcp-trust', server.name, true))}>Allow</Button>
        )}
      </div>
      <div className="flex min-w-0 items-center gap-1 pl-3.5">
        <code title={server.target} className="min-w-0 flex-1 truncate font-mono text-2xs text-text-faint">
          {server.target}
        </code>
        {own && (
          <span className="flex shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
            <IconButton size="sm" label={`Restart ${server.name}`} className="size-5!" onClick={() => act(api().invoke('coder:mcp-restart', server.name))}>
              <RotateCw size={11} strokeWidth={1.75} />
            </IconButton>
            <IconButton size="sm" label={`Change ${server.name}`} className="size-5!" onClick={onEdit}>
              <Pencil size={11} strokeWidth={1.75} />
            </IconButton>
            {server.type === 'http' && (
              <IconButton size="sm" label={`Sign out of ${server.name}`} className="size-5!" onClick={() => act(api().invoke('coder:mcp-signout', server.name))}>
                <LogOut size={11} strokeWidth={1.75} />
              </IconButton>
            )}
            <IconButton size="sm" label={`Remove ${server.name}`} className="size-5!" onClick={() => act(api().invoke('coder:mcp-remove', server.name))}>
              <Trash2 size={11} strokeWidth={1.75} />
            </IconButton>
          </span>
        )}
      </div>
      {!own && !server.trusted && <p className="pl-3.5 text-2xs text-text-muted">The project asks to run this on your computer. Allow it only if you trust the project.</p>}
      {server.state === 'signin' && !signing && <p className="pl-3.5 text-2xs text-text-muted">It needs your account. Sign in opens its page in a tab.</p>}
      {signing && <p className="pl-3.5 text-2xs text-text-muted">Finish signing in in the tab that opened, then come back.</p>}
      {(problem ?? server.error) && <p className="pl-3.5 text-2xs text-danger">{problem ?? server.error}</p>}
    </li>
  )
}

function Extensions({ items, empty }: { items: CoderExtension[]; empty: ReactNode }) {
  if (items.length === 0) return <p className="text-2xs text-text-faint">{empty}</p>
  return (
    <ul className="flex flex-col gap-1.5">
      {items.map((item) => (
        <li key={`${item.source}:${item.name}`} className="flex min-w-0 flex-col">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="min-w-0 truncate font-mono text-2xs">{item.name}</span>
            {item.source === 'project' && <span className="shrink-0 text-2xs text-text-faint">project</span>}
          </span>
          {item.description && <span className="line-clamp-2 text-2xs text-text-muted">{item.description}</span>}
        </li>
      ))}
    </ul>
  )
}

const HOOK_WORDS = { afterEdit: 'After an edit', beforeCommand: 'Before a command', afterTurn: 'After each reply' }

/** A short heading over a few rows, as in a settings sidebar. */
function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-0.5 border-b border-border px-4 py-3 last:border-b-0">
      <h3 className="pb-1 text-2xs font-medium tracking-wide text-text-faint uppercase">{title}</h3>
      {children}
    </section>
  )
}

/** Common servers not added yet, each a click away. */
function Directory({ added, onAdd }: { added: string[]; onAdd: (entry: McpDirectoryEntry) => void }) {
  const left = MCP_DIRECTORY.filter((entry) => !added.includes(entry.name))
  if (left.length === 0) return null
  return (
    <ul aria-label="Common MCP servers" className="-mx-1 flex flex-col">
      {left.map((entry) => (
        <li key={entry.id} className="group flex min-w-0 items-start gap-2 rounded-md px-1 py-1 hover:bg-surface-hover">
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="flex items-center gap-1.5 text-xs">
              {entry.name}
              {entry.signIn && <span className="text-2xs text-text-faint">sign in</span>}
              {entry.keys.length > 0 && <span className="text-2xs text-text-faint">needs a key</span>}
            </span>
            <span className="line-clamp-2 text-2xs text-text-faint">{entry.description}</span>
          </span>
          <Button className="shrink-0" onClick={() => onAdd(entry)} aria-label={`Add ${entry.name}`}>
            Add
          </Button>
        </li>
      ))}
    </ul>
  )
}

export interface SettingsTabProps {
  prefs: Settings | null
  onPrefs: (patch: Partial<Settings>) => void
  mode: CoderMode
  onMode: (mode: CoderMode) => void
  effort: CoderEffort | null
  onEffort: (effort: CoderEffort | null) => void
  sandboxAvailable: boolean
  devContainer: boolean
  /** Opens one row by its name when the panel is asked for, such as /mcp. */
  focus: string | null
  /** The project's commands may have changed. */
  onSetupChanged: () => void
  github: ReturnType<typeof useGithubStatus>
}

/** Terra Code's settings as a sidebar: each a line with its value, opening in place to change it. */
export function SettingsTab({ prefs, onPrefs, mode, onMode, effort, onEffort, sandboxAvailable, devContainer, focus, onSetupChanged, github }: SettingsTabProps) {
  const [setup, setSetup] = useState<CoderSetup | null>(null)
  const [automations, setAutomations] = useState<AutomationsState | null>(null)
  const [open, setOpen] = useState<string | null>(focus)
  const [editing, setEditing] = useState<McpServerView | 'new' | McpDirectoryEntry | null>(null)
  const [browsing, setBrowsing] = useState(false)
  /** One click for servers that need nothing filled in; the form, filled in, for the rest. */
  const addFromDirectory = (entry: McpDirectoryEntry) => {
    if (entry.keys.length) return setEditing(entry)
    const config: McpServerConfig = entry.config.type === 'stdio' ? { name: entry.name, type: 'stdio', command: entry.config.command, args: entry.config.args, env: {}, enabled: true } : { name: entry.name, type: 'http', url: entry.config.url, headers: {}, enabled: true }
    void api()
      .invoke('coder:mcp-save', config)
      .then(load, (failure: Error) => setError(cleanError(failure.message)))
  }
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(() => {
    void api().invoke('coder:setup').then(setSetup, (failure: Error) => setError(cleanError(failure.message)))
  }, [])
  useEffect(load, [load])
  useEffect(() => {
    if (focus) setOpen(focus)
  }, [focus])
  // MCP servers take a moment to start, so their state is looked at again while any are starting.
  useEffect(() => {
    if (!setup?.mcp.some((server) => server.state === 'starting')) return
    const timer = setTimeout(load, 1500)
    return () => clearTimeout(timer)
  }, [setup, load])

  const toggle = (name: string) => setOpen((current) => (current === name ? null : name))
  const setRules = (rules: { allow: string[]; deny: string[] }) => {
    setSetup((current) => current && { ...current, rules })
    void api().invoke('coder:set-rules', rules).catch((failure: Error) => setError(cleanError(failure.message)))
  }
  const where = (kind: string) => (
    <>
      Markdown files in <code className="font-mono">.terra/{kind}/</code> or <code className="font-mono">.claude/{kind}/</code>, or in your own folder for every project: <code className="font-mono break-all">{setup?.home}/{kind}</code>
    </>
  )
  const count = (n: number | undefined) => (n ? String(n) : 'None')
  const modeLabel = MODES.find((option) => option.id === mode)?.label ?? mode
  const effortLabel = effort ? (CODER_EFFORTS.find((option) => option.id === effort)?.label ?? effort) : 'Auto'
  const sandbox = prefs?.coderSandbox ?? 'off'
  const sandboxWords = sandboxLabel(sandbox, sandboxAvailable, devContainer)
  const mcpReady = setup?.mcp.filter((server) => server.state === 'ready').length ?? 0
  const projectName = setup?.folder?.split(/[\\/]/).filter(Boolean).at(-1)

  return (
    <div role="region" aria-label="Terra Code settings" className="flex flex-col">
      {error && <p className="px-4 pt-3 text-2xs text-danger">{error}</p>}
      <Group title="Working">
        <SettingRow label="Permissions" value={modeLabel} open={open === 'mode'} onToggle={() => toggle('mode')}>
          <ModeChoices mode={mode} onMode={onMode} />
        </SettingRow>
        <SettingRow label="Thinking" value={effortLabel} open={open === 'effort'} onToggle={() => toggle('effort')}>
          <EffortChoices effort={effort} onEffort={onEffort} />
        </SettingRow>
        {prefs && (
          <>
            <SettingRow label="Helpers use" value={prefs.coderAgentModel === 'quick' ? 'Quick model' : 'Session’s model'} open={open === 'helpers'} onToggle={() => toggle('helpers')}>
              <Choices
                label="Helpers use"
                value={prefs.coderAgentModel}
                onChange={(coderAgentModel) => onPrefs({ coderAgentModel })}
                options={[
                  { id: 'session', label: 'The session’s model' },
                  { id: 'quick', label: 'The quick model', hint: 'From AI settings: cheaper and faster' }
                ]}
              />
            </SettingRow>
            <SwitchRow label="Show reasoning" hint="Its thinking, folded above each step" checked={prefs.coderShowReasoning} onChange={(coderShowReasoning) => onPrefs({ coderShowReasoning })} />
            <SettingRow label="Budget per session" value={budgetLabel(prefs.coderBudget)} open={open === 'budget'} onToggle={() => toggle('budget')}>
              <Choices
                label="Budget per session"
                value={String(prefs.coderBudget)}
                onChange={(value) => onPrefs({ coderBudget: Number(value) as Settings['coderBudget'] })}
                options={CODER_BUDGETS.map((budget) => ({ id: String(budget), label: budgetLabel(budget), hint: budget === 0 ? 'It works until the task is done' : 'Tokens in and out; it stops and says so when they’re used up' }))}
              />
            </SettingRow>
          </>
        )}
      </Group>

      <Group title="Safety">
        {prefs && (
          <SettingRow label="Sandbox" value={sandboxWords} open={open === 'sandbox'} onToggle={() => toggle('sandbox')}>
            <SandboxChoices value={prefs.coderSandbox} available={sandboxAvailable} container={devContainer} onChange={(coderSandbox) => onPrefs({ coderSandbox })} />
          </SettingRow>
        )}
        <SettingRow label="Allowed commands" value={count(setup?.rules.allow.length)} open={open === 'allow'} onToggle={() => toggle('allow')}>
          <p className="text-2xs text-text-faint">
            Run without asking in {projectName ?? 'this project'}. End with * for anything after, such as <code className="font-mono">npm test*</code>. Commands that only look never ask.
          </p>
          {setup && <RuleList label="Allowed commands" rules={setup.rules.allow} placeholder="npm test*" onChange={(allow) => setRules({ ...setup.rules, allow })} />}
        </SettingRow>
        <SettingRow label="Blocked commands" value={count((setup?.rules.deny.length ?? 0) + (setup?.projectDeny.length ?? 0))} open={open === 'deny'} onToggle={() => toggle('deny')}>
          <p className="text-2xs text-text-faint">Terra Code is told no straight away, without asking you.</p>
          {setup && <RuleList label="Blocked commands" rules={setup.rules.deny} placeholder="git push*" onChange={(deny) => setRules({ ...setup.rules, deny })} />}
          {setup && setup.projectDeny.length > 0 && (
            <p className="text-2xs text-text-muted">
              The project also blocks <code className="font-mono">{setup.projectDeny.join(', ')}</code>.
            </p>
          )}
        </SettingRow>
      </Group>

      {prefs && (
        <Group title="Automatic">
          <SwitchRow label="Format after edits" hint="With the project’s formatter, when allowed" checked={prefs.coderFormat} onChange={(coderFormat) => onPrefs({ coderFormat })} />
          <SwitchRow label="Check after edits" hint={setup?.diagnostics ? `Runs ${setup.diagnostics} when allowed` : 'With the project’s checker, when allowed'} checked={prefs.coderAutoCheck} onChange={(coderAutoCheck) => onPrefs({ coderAutoCheck })} />
          <SwitchRow label="Summarise long sessions" hint="Instead of forgetting earlier steps" checked={prefs.coderAutoCompact} onChange={(coderAutoCompact) => onPrefs({ coderAutoCompact })} />
          <SwitchRow label="Notify me" hint="When it finishes or needs you" checked={prefs.coderNotify} onChange={(coderNotify) => onPrefs({ coderNotify })} />
        </Group>
      )}

      {prefs && (
        <Group title="Connections">
          <SettingRow label="GitHub" value={githubLabel(github.status, prefs.coderGithub)} open={open === 'github'} onToggle={() => toggle('github')}>
            <GithubSettings prefs={prefs} onPrefs={onPrefs} github={github} />
          </SettingRow>
          {github.status?.source && (
            <SettingRow label="On GitHub" value={automations?.saved ? 'Installed' : 'Not installed'} open={open === 'automations'} onToggle={() => toggle('automations')}>
              <AutomationsSettings canAct={prefs.coderGithub === 'write'} onState={setAutomations} />
            </SettingRow>
          )}
        </Group>
      )}

      <Group title="Extensions">
        <SettingRow
          label="MCP servers"
          value={setup?.mcp.length ? `${mcpReady ? `${mcpReady} running · ` : ''}${setup.mcp.length}` : 'None'}
          open={open === 'mcp'}
          onToggle={() => toggle('mcp')}
        >
          <p className="text-2xs text-text-faint">Tools from other programs, such as GitHub or a database. Each tool asks before it runs.</p>
          {setup && setup.mcp.length > 0 && (
            <ul className="flex flex-col">
              {setup.mcp.map((server) => (
                <ServerRow key={`${server.source}:${server.name}`} server={server} onChange={load} onEdit={() => setEditing(server)} />
              ))}
            </ul>
          )}
          {editing ? (
            <ServerForm
              key={editing === 'new' ? 'new' : 'id' in editing ? `directory:${editing.id}` : editing.name}
              editing={editing === 'new' || 'id' in editing ? null : editing}
              initial={editing !== 'new' && 'id' in editing ? editing : undefined}
              onDone={() => {
                setEditing(null)
                load()
              }}
            />
          ) : (
            <div className="flex flex-wrap gap-1">
              <Button onClick={() => setBrowsing(!browsing)} aria-expanded={browsing}>
                {browsing ? 'Hide servers' : 'Browse servers'}
              </Button>
              <Button variant="ghost" onClick={() => setEditing('new')}>
                <Plus aria-hidden size={12} strokeWidth={1.75} />
                Add your own
              </Button>
            </div>
          )}
          {browsing && !editing && setup && <Directory added={setup.mcp.map((server) => server.name)} onAdd={addFromDirectory} />}
          <p className="text-2xs text-text-faint">
            A project’s own, from <code className="font-mono">.mcp.json</code>, run once you allow them.
          </p>
        </SettingRow>
        <SettingRow label="Agents" value={count(setup?.agents.length)} open={open === 'agents'} onToggle={() => toggle('agents')}>
          <Extensions items={setup?.agents ?? []} empty={where('agents')} />
        </SettingRow>
        <SettingRow label="Skills" value={count(setup?.skills.length)} open={open === 'skills'} onToggle={() => toggle('skills')}>
          <Extensions
            items={setup?.skills ?? []}
            empty={
              <>
                Folders with a <code className="font-mono">SKILL.md</code> in <code className="font-mono">.terra/skills/</code> or <code className="font-mono">.claude/skills/</code>, or in <code className="font-mono break-all">{setup?.home}/skills</code>
              </>
            }
          />
        </SettingRow>
        <SettingRow label="Commands" value={count(setup?.commands.length)} open={open === 'commands'} onToggle={() => toggle('commands')}>
          <Extensions items={setup?.commands ?? []} empty={where('commands')} />
        </SettingRow>
        <SettingRow label="Hooks" value={count(setup?.hooks.reduce((sum, set) => sum + set.hooks.length, 0))} open={open === 'hooks'} onToggle={() => toggle('hooks')}>
          {setup?.hooks.length ? (
            setup.hooks.map((set) => (
              <div key={set.source} className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span className="text-2xs text-text-faint">{set.source === 'project' ? 'This project’s' : 'Yours'}</span>
                  <span className="min-w-0 flex-1" />
                  {set.source === 'project' && (
                    <Button
                      variant={set.trusted ? 'ghost' : 'secondary'}
                      onClick={() =>
                        void api()
                          .invoke('coder:hooks-trust', !set.trusted)
                          .then(() => (load(), onSetupChanged()))
                      }
                    >
                      {set.trusted ? 'Stop' : 'Allow'}
                    </Button>
                  )}
                </div>
                <ul className="flex flex-col gap-1">
                  {set.hooks.map((hook, index) => (
                    <li key={index} className="flex min-w-0 flex-col">
                      <span className="text-2xs text-text-muted">{HOOK_WORDS[hook.event]}</span>
                      <code className="truncate font-mono text-2xs">{hook.command}</code>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          ) : (
            <p className="text-2xs text-text-faint">
              Commands run around Terra Code’s steps, such as a formatter after each edit. Set them in <code className="font-mono">.terra/hooks.json</code>.
            </p>
          )}
        </SettingRow>
      </Group>
    </div>
  )
}
