import { ArrowLeft, Plus, RotateCw, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Button, cx, IconButton, Input, Segmented, Switch } from '@scbrowser/ui'
import { CODER_EFFORTS, type CoderEffort, type CoderExtension, type CoderSetup, type McpServerConfig, type McpServerView, type Settings } from '@scbrowser/shared'
import { api } from '../api'

const cleanError = (message: string) => message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

function Section({ title, hint, children }: { title: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-2 border-t border-border pt-4 first:border-t-0 first:pt-0">
      <div className="flex flex-col gap-0.5">
        <h3 className="text-sm font-medium">{title}</h3>
        {hint && <p className="text-xs text-text-muted">{hint}</p>}
      </div>
      {children}
    </section>
  )
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-4 py-1">
      <div className="min-w-0 flex-1">
        <p className="text-sm">{label}</p>
        {hint && <p className="text-xs text-text-muted">{hint}</p>}
      </div>
      {children}
    </div>
  )
}

const Source = ({ source }: { source: 'project' | 'global' }) => (
  <span className="shrink-0 rounded-sm border border-border px-1 text-2xs text-text-faint">{source === 'project' ? 'This project' : 'Yours'}</span>
)

/** Rules as a list to remove from, with a box to add one. */
function RuleList({ label, rules, placeholder, onChange }: { label: string; rules: string[]; placeholder: string; onChange: (rules: string[]) => void }) {
  const [adding, setAdding] = useState('')
  const add = () => {
    const rule = adding.trim()
    if (rule && !rules.includes(rule)) onChange([...rules, rule])
    setAdding('')
  }
  return (
    <div className="flex flex-col gap-1">
      {rules.length > 0 && (
        <ul aria-label={label} className="flex flex-col">
          {rules.map((rule) => (
            <li key={rule} className="group flex h-7 items-center gap-2 rounded-md px-1.5 hover:bg-surface-hover">
              <code className="min-w-0 flex-1 truncate font-mono text-2xs">{rule}</code>
              <IconButton size="sm" label={`Remove ${rule}`} className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100" onClick={() => onChange(rules.filter((other) => other !== rule))}>
                <X size={12} strokeWidth={1.75} />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex gap-1.5"
        onSubmit={(e) => {
          e.preventDefault()
          add()
        }}
      >
        <Input aria-label={`Add to ${label.toLowerCase()}`} value={adding} placeholder={placeholder} onChange={(e) => setAdding(e.target.value)} className="h-7 min-w-0 flex-1 font-mono text-xs" />
        <Button type="submit" disabled={!adding.trim()}>
          Add
        </Button>
      </form>
    </div>
  )
}

const STATE_COLOURS: Record<McpServerView['state'], string> = { ready: 'bg-success', starting: 'bg-accent', error: 'bg-danger', off: 'bg-border-strong' }
const STATE_WORDS: Record<McpServerView['state'], string> = { ready: 'Running', starting: 'Starting', error: 'Not working', off: 'Starts when Terra Code needs it' }

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
function ServerForm({ editing, onDone }: { editing: McpServerView | null; onDone: () => void }) {
  const [name, setName] = useState(editing?.name ?? '')
  const [type, setType] = useState<'stdio' | 'http'>(editing?.type ?? 'stdio')
  const [target, setTarget] = useState(editing?.target ?? '')
  const [secrets, setSecrets] = useState(editing ? editing.envKeys.map((key) => `${key}=`).join('\n') : '')
  const [error, setError] = useState<string | null>(null)
  const save = () => {
    setError(null)
    const values = pairs(secrets)
    const server: McpServerConfig = type === 'stdio' ? { name: name.trim(), type, command: words(target)[0] ?? '', args: words(target).slice(1), env: values, enabled: editing?.enabled ?? true } : { name: name.trim(), type, url: target.trim(), headers: values, enabled: editing?.enabled ?? true }
    void api().invoke('coder:mcp-save', server).then(onDone, (failure: Error) => setError(cleanError(failure.message)))
  }
  return (
    <div role="group" aria-label={editing ? `Change ${editing.name}` : 'Add an MCP server'} className="flex flex-col gap-2 rounded-lg border border-border-strong p-3">
      <div className="flex gap-2">
        <Input aria-label="Server name" value={name} disabled={!!editing} placeholder="Name, such as github" onChange={(e) => setName(e.target.value)} className="h-8 w-40" />
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
      </div>
      <Input aria-label={type === 'stdio' ? 'Command' : 'Address'} value={target} placeholder={type === 'stdio' ? 'npx -y @modelcontextprotocol/server-github' : 'https://example.com/mcp'} onChange={(e) => setTarget(e.target.value)} className="h-8 font-mono text-xs" />
      <textarea
        aria-label={type === 'stdio' ? 'Environment variables' : 'Headers'}
        value={secrets}
        placeholder={type === 'stdio' ? 'GITHUB_TOKEN=…   (one per line, kept encrypted)' : 'Authorization: Bearer …   (one per line, kept encrypted)'}
        onChange={(e) => setSecrets(e.target.value)}
        rows={2}
        className="resize-none rounded-md border border-border bg-field px-2.5 py-1.5 font-mono text-xs outline-none placeholder:text-text-faint focus:border-border-strong"
      />
      {editing && <p className="text-2xs text-text-faint">Leave a value empty to keep the one saved.</p>}
      {error && <p className="text-xs text-danger">{error}</p>}
      <div className="flex justify-end gap-1.5">
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

function ServerRow({ server, onChange, onEdit }: { server: McpServerView; onChange: () => void; onEdit: () => void }) {
  const act = (promise: Promise<unknown>) => void promise.then(onChange, onChange)
  return (
    <li className="flex flex-col gap-1 rounded-md px-1.5 py-1.5 hover:bg-surface-hover">
      <div className="flex min-w-0 items-center gap-2">
        <span role="img" aria-label={STATE_WORDS[server.state]} title={STATE_WORDS[server.state]} className={cx('size-1.5 shrink-0 rounded-full', STATE_COLOURS[server.state])} />
        <span className="shrink-0 text-sm font-medium">{server.name}</span>
        {server.source === 'project' && <Source source="project" />}
        <code title={server.target} className="min-w-0 flex-1 truncate font-mono text-2xs text-text-faint">{server.target}</code>
        {server.tools.length > 0 && <span className="shrink-0 text-2xs text-text-muted">{server.tools.length} tools</span>}
        {server.source === 'global' ? (
          <>
            <IconButton size="sm" label={`Restart ${server.name}`} onClick={() => act(api().invoke('coder:mcp-restart', server.name))}>
              <RotateCw size={12} strokeWidth={1.75} />
            </IconButton>
            <Button variant="ghost" onClick={onEdit}>
              Change
            </Button>
            <IconButton size="sm" label={`Remove ${server.name}`} onClick={() => act(api().invoke('coder:mcp-remove', server.name))}>
              <Trash2 size={12} strokeWidth={1.75} />
            </IconButton>
            <Switch label={`Use ${server.name}`} checked={server.enabled} onChange={() => act(toggleServer(server))} />
          </>
        ) : server.trusted ? (
          <Button variant="ghost" onClick={() => act(api().invoke('coder:mcp-trust', server.name, false))}>
            Stop allowing
          </Button>
        ) : (
          <Button onClick={() => act(api().invoke('coder:mcp-trust', server.name, true))}>Allow</Button>
        )}
      </div>
      {server.source === 'project' && !server.trusted && <p className="pl-3.5 text-2xs text-text-muted">This project asks to run this on your computer. Allow it only if you trust the project.</p>}
      {server.error && <p className="pl-3.5 text-2xs text-danger">{server.error}</p>}
    </li>
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

function Extensions({ items, empty }: { items: CoderExtension[]; empty: ReactNode }) {
  if (items.length === 0) return <p className="text-xs text-text-faint">{empty}</p>
  return (
    <ul className="flex flex-col">
      {items.map((item) => (
        <li key={`${item.source}:${item.name}`} className="flex h-7 min-w-0 items-center gap-2 px-1.5">
          <span className="shrink-0 font-mono text-xs">{item.name}</span>
          <span className="min-w-0 flex-1 truncate text-xs text-text-muted">{item.description}</span>
          <Source source={item.source} />
        </li>
      ))}
    </ul>
  )
}

const HOOK_WORDS = { afterEdit: 'After an edit', beforeCommand: 'Before a command', afterTurn: 'After each reply' }

/** Terra Code's settings for the open project: what runs without asking, MCP servers, and what the project adds. */
export function CodeSettings({ sandboxAvailable, onClose }: { sandboxAvailable: boolean; onClose: () => void }) {
  const [setup, setSetup] = useState<CoderSetup | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [editing, setEditing] = useState<McpServerView | 'new' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(() => {
    void api().invoke('coder:setup').then(setSetup, (failure: Error) => setError(cleanError(failure.message)))
    void api().invoke('settings:get').then(setSettings)
  }, [])
  useEffect(load, [load])
  // MCP servers take a moment to start, so their state is looked at again while any are starting.
  useEffect(() => {
    if (!setup?.mcp.some((server) => server.state === 'starting')) return
    const timer = setTimeout(load, 1500)
    return () => clearTimeout(timer)
  }, [setup, load])

  const update = (patch: Partial<Settings>) => {
    setSettings((current) => current && { ...current, ...patch })
    void api().invoke('settings:set', patch)
  }
  const setRules = (rules: { allow: string[]; deny: string[] }) => {
    setSetup((current) => current && { ...current, rules })
    void api().invoke('coder:set-rules', rules).catch((failure: Error) => setError(cleanError(failure.message)))
  }

  const folderHint = (kind: string) => (
    <>
      Markdown files in <code className="font-mono">.terra/{kind}/</code> (or <code className="font-mono">.claude/{kind}/</code>) in the project, or in <code className="font-mono break-all">{setup?.home}/{kind}</code> for every project.
    </>
  )

  return (
    <div role="region" aria-label="Terra Code settings" className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border px-2">
        <IconButton size="sm" label="Back to the conversation" onClick={onClose}>
          <ArrowLeft size={14} strokeWidth={1.75} />
        </IconButton>
        <h2 className="text-sm font-medium">Terra Code settings</h2>
      </div>
      <div className="sc-scroll-quiet min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-170 flex-col gap-5 px-6 py-5">
          {error && <p className="text-xs text-danger">{error}</p>}
          {settings && (
            <Section title="How it works">
              <Row label="Fence commands in" hint={sandboxAvailable ? 'Commands can only write inside the project (and build caches). No network also cuts them off from the internet.' : 'Needs Linux with bubblewrap installed.'}>
                <Segmented
                  label="Fence commands in"
                  size="sm"
                  fill={false}
                  disabled={!sandboxAvailable}
                  value={sandboxAvailable ? settings.coderSandbox : 'off'}
                  onChange={(coderSandbox) => update({ coderSandbox })}
                  options={[
                    ['off', 'Off'],
                    ['project', 'Project only'],
                    ['offline', 'No network']
                  ]}
                />
              </Row>
              <Row label="Check the code after edits" hint={setup?.diagnostics ? `Runs ${setup.diagnostics} after changes, when it’s allowed to run without asking.` : 'When the project has a type checker or linter Terra Code can find.'}>
                <Switch label="Check the code after edits" checked={settings.coderAutoCheck} onChange={(coderAutoCheck) => update({ coderAutoCheck })} />
              </Row>
              <Row label="Summarise long sessions" hint="Keeps a summary of earlier steps when the model’s memory fills up, instead of forgetting them.">
                <Switch label="Summarise long sessions" checked={settings.coderAutoCompact} onChange={(coderAutoCompact) => update({ coderAutoCompact })} />
              </Row>
              <Row label="Notify me" hint="When it finishes or needs an answer while scTerra is in the background.">
                <Switch label="Notify me" checked={settings.coderNotify} onChange={(coderNotify) => update({ coderNotify })} />
              </Row>
            </Section>
          )}
          {settings && (
            <Section title="Model" hint="Each session can change these from the message box.">
              <Row label="Thinking" hint="How hard the model thinks before it acts, for models that can be told. Auto is Medium for coding.">
                <select
                  aria-label="Thinking"
                  value={settings.coderEffort ?? 'auto'}
                  onChange={(e) => update({ coderEffort: e.target.value === 'auto' ? null : (e.target.value as CoderEffort) })}
                  className="h-7 rounded-md border border-border bg-field px-2 text-xs outline-none focus:border-border-strong"
                >
                  <option value="auto">Auto</option>
                  {CODER_EFFORTS.map((effort) => (
                    <option key={effort.id} value={effort.id}>
                      {effort.label}
                    </option>
                  ))}
                </select>
              </Row>
              <Row label="Show the model’s reasoning" hint="A summary of its thinking before each step, folded away. Claude and models such as DeepSeek and Qwen give it; others don’t.">
                <Switch label="Show the model’s reasoning" checked={settings.coderShowReasoning} onChange={(coderShowReasoning) => update({ coderShowReasoning })} />
              </Row>
              <Row label="Model for helpers" hint="Explore and agents work in conversations of their own. The quick model from AI settings is cheaper and faster.">
                <Segmented
                  label="Model for helpers"
                  size="sm"
                  fill={false}
                  value={settings.coderAgentModel}
                  onChange={(coderAgentModel) => update({ coderAgentModel })}
                  options={[
                    ['session', 'Same as the session'],
                    ['quick', 'Quick model']
                  ]}
                />
              </Row>
            </Section>
          )}
          {setup && (
            <>
              <Section title="Commands that run without asking" hint={<>For {setup.folder ? <code className="font-mono">{setup.folder.split(/[\\/]/).filter(Boolean).at(-1)}</code> : 'this project'}. End a rule with * to cover what follows, such as <code className="font-mono">npm test*</code>. Commands that only look, like <code className="font-mono">git status</code>, never ask.</>}>
                <RuleList label="Allowed commands" rules={setup.rules.allow} placeholder="npm test*" onChange={(allow) => setRules({ ...setup.rules, allow })} />
              </Section>
              <Section title="Commands that never run" hint="Terra Code is told no straight away, without asking you.">
                <RuleList label="Blocked commands" rules={setup.rules.deny} placeholder="git push*" onChange={(deny) => setRules({ ...setup.rules, deny })} />
                {setup.projectDeny.length > 0 && (
                  <p className="text-2xs text-text-muted">
                    The project also blocks <code className="font-mono">{setup.projectDeny.join(', ')}</code> in .terra/settings.json.
                  </p>
                )}
              </Section>
              <Section title="MCP servers" hint="Tools from other programs and services, such as GitHub or a database. Terra Code asks before using each tool, unless you allow it for this project.">
                {setup.mcp.length > 0 && (
                  <ul className="flex flex-col">
                    {setup.mcp.map((server) => (
                      <ServerRow key={`${server.source}:${server.name}`} server={server} onChange={load} onEdit={() => setEditing(server)} />
                    ))}
                  </ul>
                )}
                {editing ? (
                  <ServerForm
                    key={editing === 'new' ? 'new' : editing.name}
                    editing={editing === 'new' ? null : editing}
                    onDone={() => {
                      setEditing(null)
                      load()
                    }}
                  />
                ) : (
                  <div>
                    <Button onClick={() => setEditing('new')}>
                      <Plus aria-hidden size={13} strokeWidth={1.75} />
                      Add a server
                    </Button>
                  </div>
                )}
                <p className="text-2xs text-text-faint">
                  A project can bring its own in <code className="font-mono">.mcp.json</code>. They only run once you allow them.
                </p>
              </Section>
              <Section title="Agents" hint="Helpers with their own instructions, which Terra Code hands work to.">
                <Extensions items={setup.agents} empty={folderHint('agents')} />
              </Section>
              <Section title="Skills" hint="Instructions Terra Code loads when a task matches them.">
                <Extensions items={setup.skills} empty={<>Folders with a <code className="font-mono">SKILL.md</code> in <code className="font-mono">.terra/skills/</code> or <code className="font-mono">.claude/skills/</code>, or in <code className="font-mono break-all">{setup.home}/skills</code>.</>} />
              </Section>
              <Section title="Commands" hint="Your own / commands, which stand for a longer task. $ARGUMENTS is what’s typed after them.">
                <Extensions items={setup.commands} empty={folderHint('commands')} />
              </Section>
              <Section title="Hooks" hint={<>Commands run around Terra Code’s steps, such as a formatter after each edit. Set them in <code className="font-mono">.terra/hooks.json</code>.</>}>
                {setup.hooks.length === 0 && <p className="text-xs text-text-faint">None.</p>}
                {setup.hooks.map((set) => (
                  <div key={set.source} className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <Source source={set.source} />
                      <span className="min-w-0 flex-1" />
                      {set.source === 'project' && (
                        <Button variant={set.trusted ? 'ghost' : 'secondary'} onClick={() => void api().invoke('coder:hooks-trust', !set.trusted).then(load)}>
                          {set.trusted ? 'Stop allowing' : 'Allow'}
                        </Button>
                      )}
                    </div>
                    <ul className="flex flex-col">
                      {set.hooks.map((hook, index) => (
                        <li key={index} className="flex h-7 min-w-0 items-center gap-2 px-1.5">
                          <span className="w-28 shrink-0 text-xs text-text-muted">{HOOK_WORDS[hook.event]}</span>
                          <code className="min-w-0 flex-1 truncate font-mono text-2xs">{hook.command}</code>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </Section>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
