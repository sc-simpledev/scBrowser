import { Plus, TriangleAlert, X } from 'lucide-react'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Button, IconButton, Input, Select } from '@scbrowser/ui'
import { HOSTED_PROVIDER_ID, isInsecureEndpoint, PROVIDER_PRESETS, type AiState, type ProviderProtocol, type Skill } from '@scbrowser/shared'
import { api } from '../api'

const CUSTOM = 'custom'
const numberFormat = new Intl.NumberFormat()

const formatUsd = (amount: number) =>
  amount > 0 && amount < 0.01 ? 'under $0.01' : amount.toLocaleString(undefined, { style: 'currency', currency: 'USD' })

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-text-muted">{label}</span>
      {children}
      {hint && <span className="text-xs text-text-faint">{hint}</span>}
    </label>
  )
}

function AddProvider({ onSaved }: { onSaved: () => void }) {
  const [preset, setPreset] = useState(PROVIDER_PRESETS[0]!.id)
  const [name, setName] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [protocol, setProtocol] = useState<ProviderProtocol>('openai')
  const [apiKey, setApiKey] = useState('')
  const [headers, setHeaders] = useState('')
  const [models, setModels] = useState('')
  const [error, setError] = useState<string | null>(null)

  const chosen = PROVIDER_PRESETS.find((p) => p.id === preset)
  const address = chosen?.baseUrl ?? baseUrl
  // A hosted provider without its key would only fail on the first message.
  const ready = Boolean(address) && !(chosen?.needsKey && !apiKey.trim())

  const save = async () => {
    setError(null)
    try {
      await api().invoke('ai:save-provider', {
        id: null,
        name: chosen?.name ?? name,
        protocol: chosen?.protocol ?? protocol,
        baseUrl: address,
        models: models.split(/[\s,]+/).filter(Boolean),
        apiKey,
        headers
      })
      setApiKey('')
      setHeaders('')
      setName('')
      setBaseUrl('')
      setModels('')
      onSaved()
    } catch (failure) {
      // Electron prefixes remote errors with the channel; keep only the message.
      setError(failure instanceof Error ? failure.message.replace(/^.*Error: /, '') : "Couldn't save this provider.")
    }
  }

  return (
    <section aria-label="Add a provider" className="flex flex-col gap-3 rounded-lg p-3 shadow-1">
      <h2 className="font-medium">Add a provider</h2>
      {/* A form, so Enter in any field adds the provider. */}
      <form
        className="contents"
        onSubmit={(e) => {
          e.preventDefault()
          if (ready) void save()
        }}
      >
      <Field label="Provider">
        <Select aria-label="Provider" value={preset} onChange={(e) => setPreset(e.target.value)}>
          {PROVIDER_PRESETS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
          <option value={CUSTOM}>Custom endpoint</option>
        </Select>
      </Field>
      {!chosen && (
        <>
          <Field label="Name">
            <Input aria-label="Name" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Base URL" hint="For example https://gateway.example.com/v1">
            <Input aria-label="Base URL" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
          </Field>
          <Field label="API format">
            <Select aria-label="API format" value={protocol} onChange={(e) => setProtocol(e.target.value as ProviderProtocol)}>
              <option value="openai">OpenAI-compatible</option>
              <option value="anthropic">Anthropic-compatible</option>
            </Select>
          </Field>
          <Field label="Extra headers" hint="One per line, as Name: value. Stored encrypted.">
            <textarea
              aria-label="Extra headers"
              rows={2}
              spellCheck={false}
              value={headers}
              onChange={(e) => setHeaders(e.target.value)}
              className="rounded-md bg-field px-2.5 py-1.5 font-mono text-xs text-text outline-none focus-visible:outline-2 focus-visible:outline-focus-ring"
            />
          </Field>
          <Field label="Models" hint="Only needed if the endpoint can't list its models. Separate with spaces.">
            <Input aria-label="Models" value={models} onChange={(e) => setModels(e.target.value)} />
          </Field>
        </>
      )}
      {(!chosen || chosen.needsKey) && (
        <Field label="API key" hint="Encrypted on this device and sent only to this provider.">
          <Input aria-label="API key" type="password" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
        </Field>
      )}
      {isInsecureEndpoint(address) && (
        <p role="alert" className="flex items-center gap-1.5 text-xs text-danger">
          <TriangleAlert aria-hidden size={12} strokeWidth={1.75} />
          This address isn't encrypted, so your key and pages can be read on the network.
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
      <div>
        <Button type="submit" variant="primary" disabled={!ready}>
          Add provider
        </Button>
      </div>
      </form>
    </section>
  )
}

function ProviderRow({ provider, state, onChange }: { provider: AiState['providers'][number]; state: AiState; onChange: () => void }) {
  const [models, setModels] = useState<string[]>(provider.models)
  const [error, setError] = useState<string | null>(null)
  const [checked, setChecked] = useState(false)
  const chat = state.roles.chat
  const usage = state.usage[provider.id]
  const selected = chat?.providerId === provider.id ? chat.model : ''

  const load = useCallback(async () => {
    const result = await api().invoke('ai:models', provider.id)
    setModels(result.models)
    setError(result.error)
    setChecked(true)
  }, [provider.id])

  useEffect(() => void load(), [load])

  const options = selected && !models.includes(selected) ? [selected, ...models] : models

  return (
    <li className="flex flex-col gap-2 border-b border-border p-3 last:border-b-0">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{provider.name}</div>
          <div className="truncate text-xs text-text-faint">{provider.baseUrl}</div>
        </div>
        <Button variant="ghost" onClick={() => void load()}>
          Test connection
        </Button>
        <IconButton
          label={`Remove ${provider.name}`}
          onClick={() => void api().invoke('ai:remove-provider', provider.id).then(onChange)}
        >
          <X size={14} strokeWidth={1.75} />
        </IconButton>
      </div>
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : (
        checked && <p className="text-xs text-text-faint">Connected, {models.length} {models.length === 1 ? 'model' : 'models'} available</p>
      )}
      <div className="flex items-center justify-between gap-4">
        <span className="text-xs text-text-muted">Model for chat</span>
        <Select
          aria-label={`Chat model for ${provider.name}`}
          className="max-w-80"
          value={selected}
          onChange={(e) =>
            void api().invoke('ai:set-role', 'chat', { providerId: provider.id, model: e.target.value }).then(onChange)
          }
        >
          <option value="">Not used for chat</option>
          {options.map((model) => (
            <option key={model} value={model}>
              {model}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex items-center justify-between gap-4">
        <span className="text-xs text-text-muted">Model for quick tasks</span>
        <Select
          aria-label={`Quick model for ${provider.name}`}
          className="max-w-80"
          value={state.roles.fast?.providerId === provider.id ? state.roles.fast.model : ''}
          onChange={(e) =>
            void api().invoke('ai:set-role', 'fast', { providerId: provider.id, model: e.target.value }).then(onChange)
          }
        >
          <option value="">Same as chat</option>
          {options.map((model) => (
            <option key={model} value={model}>
              {model}
            </option>
          ))}
        </Select>
      </div>
      {usage && (
        <p className="text-xs text-text-faint">
          Used {numberFormat.format(usage.inputTokens)} input and {numberFormat.format(usage.outputTokens)} output tokens
          {usage.estimatedUsd !== null && provider.firstParty && `, about ${formatUsd(usage.estimatedUsd)} at list prices`}
        </p>
      )}
    </li>
  )
}

function HostedCard({ onChange }: { onChange: () => void }) {
  return (
    <section aria-label="scTerra AI" className="flex items-center justify-between gap-4 rounded-lg p-3 shadow-1">
      <div className="min-w-0">
        <div className="font-medium">scTerra AI</div>
        <div className="text-xs text-text-faint">
          No key needed, with daily limits. Messages and pages you share go to our server and its AI provider, and we
          don't store them.
        </div>
      </div>
      <Button variant="primary" className="shrink-0" onClick={() => void api().invoke('ai:enable-hosted').then(onChange)}>
        Use scTerra AI
      </Button>
    </section>
  )
}

function SkillsEditor({ skills, onChange }: { skills: Skill[]; onChange: () => void }) {
  const [name, setName] = useState('')
  const [prompt, setPrompt] = useState('')
  const save = (next: Skill[]) => void api().invoke('ai:save-skills', next).then(onChange)

  return (
    <section aria-label="Skills" className="flex flex-col gap-2 rounded-lg p-3 shadow-1">
      <h2 className="font-medium">Skills</h2>
      <p className="text-xs text-text-faint">Saved prompts. Type / in the assistant to run one.</p>
      <ul>
        {skills.map((skill) => (
          <li key={skill.id} className="flex items-center gap-2 rounded-md px-1 py-1 hover:bg-surface-hover">
            <div className="min-w-0 flex-1">
              <div className="truncate">{skill.name}</div>
              <div className="truncate text-xs text-text-faint">{skill.prompt}</div>
            </div>
            <IconButton label={`Delete ${skill.name}`} onClick={() => save(skills.filter((s) => s.id !== skill.id))}>
              <X size={14} strokeWidth={1.75} />
            </IconButton>
          </li>
        ))}
      </ul>
      <form
        className="contents"
        onSubmit={(e) => {
          e.preventDefault()
          if (!name.trim() || !prompt.trim()) return
          save([...skills, { id: crypto.randomUUID(), name: name.trim(), prompt: prompt.trim() }])
          setName('')
          setPrompt('')
        }}
      >
      <Input aria-label="Skill name" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
      <Input aria-label="Skill prompt" placeholder="Prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} />
      <div>
        <Button type="submit" disabled={!name.trim() || !prompt.trim()}>
          <Plus aria-hidden size={14} strokeWidth={1.75} />
          Add skill
        </Button>
      </div>
      </form>
    </section>
  )
}

export function AiPage() {
  const [state, setState] = useState<AiState | null>(null)
  const load = useCallback(() => void api().invoke('ai:state').then(setState), [])
  useEffect(load, [load])

  if (!state) return null
  return (
    <>
      <p className="text-text-muted">
        Use your own key, a model running on this computer, or scTerra AI where it's offered. Page text is only sent
        when you ask the assistant something with the page attached.
      </p>
      {!state.keysProtected && (
        <p role="alert" className="flex items-center gap-1.5 text-xs text-danger">
          <TriangleAlert aria-hidden size={12} strokeWidth={1.75} />
          No system keyring was found, so saved keys are only lightly protected on this device.
        </p>
      )}
      {state.hostedAvailable && !state.providers.some((p) => p.id === HOSTED_PROVIDER_ID) && <HostedCard onChange={load} />}
      {state.providers.length > 0 && (
        <ul aria-label="Providers" className="flex flex-col rounded-lg shadow-1">
          {state.providers.map((provider) => (
            <ProviderRow key={provider.id} provider={provider} state={state} onChange={load} />
          ))}
        </ul>
      )}
      <AddProvider onSaved={load} />
      <SkillsEditor skills={state.skills} onChange={load} />
      {state.disabledHosts.length > 0 && (
        <section aria-label="Sites with AI off" className="flex flex-col gap-1">
          <h2 className="text-xs font-medium text-text-muted">AI is off for these sites</h2>
          <ul>
            {state.disabledHosts.map((host) => (
              <li key={host} className="flex h-9 items-center justify-between rounded-md px-2 hover:bg-surface-hover">
                {host}
                <Button variant="ghost" onClick={() => void api().invoke('ai:set-site', host, false).then(load)}>
                  Allow
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  )
}
