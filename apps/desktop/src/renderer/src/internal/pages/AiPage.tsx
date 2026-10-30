import { TriangleAlert, X } from 'lucide-react'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Button, IconButton, Input, Select } from '@scbrowser/ui'
import { isInsecureEndpoint, PROVIDER_PRESETS, type AiState, type ProviderProtocol } from '@scbrowser/shared'
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
        <Button variant="primary" disabled={!address} onClick={() => void save()}>
          Add provider
        </Button>
      </div>
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
      {usage && (
        <p className="text-xs text-text-faint">
          Used {numberFormat.format(usage.inputTokens)} input and {numberFormat.format(usage.outputTokens)} output tokens
          {usage.estimatedUsd !== null && provider.firstParty && `, about ${formatUsd(usage.estimatedUsd)} at list prices`}
        </p>
      )}
    </li>
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
        scBrowser has no AI account of its own. Use your own key, or a model running on this computer. Page text is
        only sent when you ask the assistant something with the page attached.
      </p>
      {!state.keysProtected && (
        <p role="alert" className="flex items-center gap-1.5 text-xs text-danger">
          <TriangleAlert aria-hidden size={12} strokeWidth={1.75} />
          No system keyring was found, so saved keys are only lightly protected on this device.
        </p>
      )}
      {state.providers.length > 0 && (
        <ul aria-label="Providers" className="flex flex-col rounded-lg shadow-1">
          {state.providers.map((provider) => (
            <ProviderRow key={provider.id} provider={provider} state={state} onChange={load} />
          ))}
        </ul>
      )}
      <AddProvider onSaved={load} />
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
