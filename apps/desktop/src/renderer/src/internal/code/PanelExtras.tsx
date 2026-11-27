import { FolderPlus, Package, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Button, IconButton, Input, Switch } from '@scbrowser/ui'
import type { CoderPlugin, CoderPluginPreview } from '@scbrowser/shared'
import { api } from '../api'

const cleanError = (message: string) => message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/** What a plugin brings, as short lines, so nothing is added unseen. */
function Pieces({ plugin }: { plugin: CoderPlugin }) {
  const rows: [string, string[]][] = [
    ['Commands', plugin.commands.map((name) => `/${name}`)],
    ['Agents', plugin.agents],
    ['Skills', plugin.skills],
    ['Hooks (commands it runs)', plugin.hooks],
    ['MCP servers (programs it starts)', plugin.mcp]
  ]
  return (
    <dl className="flex flex-col gap-1">
      {rows
        .filter(([, items]) => items.length > 0)
        .map(([label, items]) => (
          <div key={label} className="flex flex-col">
            <dt className="text-2xs text-text-faint">{label}</dt>
            <dd className="flex flex-col">
              {items.map((item) => (
                <code key={item} className="truncate font-mono text-2xs" title={item}>
                  {item}
                </code>
              ))}
            </dd>
          </div>
        ))}
    </dl>
  )
}

/**
 * Plugins, as Claude Code has them: a Git address or folder holding commands, agents, skills, hooks
 * and MCP servers. Looking one up lists every piece; only "Add" installs it.
 */
export function PluginsSettings({ onChanged }: { onChanged: () => void }) {
  const [plugins, setPlugins] = useState<CoderPlugin[] | null>(null)
  const [source, setSource] = useState('')
  const [preview, setPreview] = useState<CoderPluginPreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(() => void api().invoke('coder:plugins').then(setPlugins, (failure: Error) => setError(cleanError(failure.message))), [])
  useEffect(load, [load])
  const run = <T,>(call: Promise<T>, then: (value: T) => void) => {
    setBusy(true)
    setError(null)
    void call
      .then(then, (failure: Error) => setError(cleanError(failure.message)))
      .finally(() => setBusy(false))
  }
  const changed = (list: CoderPlugin[]) => {
    setPlugins(list)
    onChanged()
  }
  return (
    <div className="flex flex-col gap-2">
      <p className="text-2xs text-text-faint">Sets of commands, agents, skills, hooks and MCP servers, in Claude Code’s plugin layout. From a Git address, owner/name on GitHub, or a folder. You see everything in one before it’s added.</p>
      {plugins && plugins.length > 0 && (
        <ul aria-label="Installed plugins" className="flex flex-col gap-1.5">
          {plugins.map((plugin) => (
            <li key={plugin.name} className="flex flex-col gap-1 rounded-md border border-border p-1.5">
              <div className="flex items-center gap-1.5">
                <Package aria-hidden size={12} strokeWidth={1.75} className="shrink-0 text-text-faint" />
                <span className="min-w-0 flex-1 truncate text-xs font-medium" title={plugin.source}>
                  {plugin.name}
                  {plugin.version && <span className="font-normal text-text-faint"> {plugin.version}</span>}
                </span>
                <Switch label={`${plugin.name} on`} checked={plugin.enabled} disabled={busy} onChange={(on) => run(api().invoke('coder:plugin-toggle', plugin.name, on), changed)} />
                <IconButton size="sm" label={`Remove ${plugin.name}`} disabled={busy} onClick={() => run(api().invoke('coder:plugin-remove', plugin.name), changed)}>
                  <Trash2 size={12} strokeWidth={1.75} />
                </IconButton>
              </div>
              {plugin.description && <p className="line-clamp-2 text-2xs text-text-faint">{plugin.description}</p>}
            </li>
          ))}
        </ul>
      )}
      {preview ? (
        <div className="flex flex-col gap-2 rounded-md border border-border-strong p-2">
          <div className="flex items-center gap-1.5">
            <span className="min-w-0 flex-1 truncate text-2xs text-text-muted">In {preview.source}</span>
            <IconButton size="sm" label="Close the preview" onClick={() => setPreview(null)}>
              <X size={12} strokeWidth={2} />
            </IconButton>
          </div>
          {preview.plugins.map((plugin) => (
            <div key={plugin.name} className="flex flex-col gap-1.5 border-t border-border pt-1.5 first-of-type:border-t-0 first-of-type:pt-0">
              <div className="flex items-center gap-1.5">
                <span className="min-w-0 flex-1 truncate text-xs font-medium">
                  {plugin.name}
                  {plugin.version && <span className="font-normal text-text-faint"> {plugin.version}</span>}
                </span>
                <Button
                  variant="primary"
                  disabled={busy}
                  onClick={() =>
                    run(api().invoke('coder:plugin-install', preview.id, plugin.name), (list) => {
                      changed(list)
                      if (preview.plugins.length === 1) setPreview(null)
                    })
                  }
                >
                  {plugin.installed ? 'Replace' : 'Add'}
                </Button>
              </div>
              {plugin.description && <p className="text-2xs text-text-faint">{plugin.description}</p>}
              <Pieces plugin={plugin} />
            </div>
          ))}
        </div>
      ) : (
        <form
          className="flex gap-1"
          onSubmit={(event) => {
            event.preventDefault()
            if (source.trim()) run(api().invoke('coder:plugin-preview', source.trim()), setPreview)
          }}
        >
          <Input aria-label="Plugin source" value={source} placeholder="owner/name or a Git address" onChange={(e) => setSource(e.target.value)} className="h-7 min-w-0 flex-1 font-mono text-2xs" />
          <Button type="submit" disabled={busy || !source.trim()}>
            {busy ? 'Looking…' : 'Look'}
          </Button>
        </form>
      )}
      {error && <p className="text-2xs text-danger">{error}</p>}
    </div>
  )
}

/** Folders besides the project Terra Code may read and edit, like Claude Code's /add-dir. */
export function DirsSettings() {
  const [dirs, setDirs] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  useEffect(() => void api().invoke('coder:dirs').then(setDirs, () => setDirs([])), [])
  const add = () =>
    void api()
      .invoke('coder:add-dir', null)
      .then(
        (next) => {
          if (next) setDirs(next)
          setError(null)
        },
        (failure: Error) => setError(cleanError(failure.message))
      )
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-2xs text-text-faint">A shared library or a docs repository it may also read and edit, with the same asking as the project. Commands still start in the project folder.</p>
      {dirs.length > 0 && (
        <ul aria-label="More folders" className="flex flex-col">
          {dirs.map((dir) => (
            <li key={dir} className="flex min-w-0 items-center gap-1">
              <code className="min-w-0 flex-1 truncate font-mono text-2xs" title={dir}>
                {dir}
              </code>
              <IconButton size="sm" label={`Stop using ${dir}`} onClick={() => void api().invoke('coder:remove-dir', dir).then(setDirs)}>
                <X size={12} strokeWidth={2} />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
      <div>
        <Button onClick={add}>
          <FolderPlus aria-hidden size={12} strokeWidth={1.75} />
          Add a folder
        </Button>
      </div>
      {error && <p className="text-2xs text-danger">{error}</p>}
    </div>
  )
}

/** The person's own command for the status line under the box, as Claude Code's statusLine. */
export function StatusLineSettings({ value, onChange }: { value: string; onChange: (command: string) => void }) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-2xs text-text-faint">
        A command whose first line shows under the box. It gets the session as JSON on its input, with the same fields as Claude Code’s, so scripts for it work: <code className="font-mono">model.display_name</code>, <code className="font-mono">workspace.current_dir</code>, <code className="font-mono">cost.total_cost_usd</code>.
      </p>
      <form
        className="flex gap-1"
        onSubmit={(event) => {
          event.preventDefault()
          onChange(draft.trim())
        }}
      >
        <Input aria-label="Status line command" value={draft} placeholder="~/.claude/statusline.sh" onChange={(e) => setDraft(e.target.value)} className="h-7 min-w-0 flex-1 font-mono text-2xs" />
        <Button type="submit" disabled={draft.trim() === value}>
          Save
        </Button>
      </form>
      {value && (
        <div>
          <Button variant="ghost" onClick={() => onChange('')}>
            Use the built-in line
          </Button>
        </div>
      )}
    </div>
  )
}
