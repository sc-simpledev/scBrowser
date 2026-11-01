import { X } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Button, IconButton, Input, Select, Switch } from '@scbrowser/ui'
import { DEFAULT_BLOCKER, toDomain, type BlockerConfig, type BlockRule, type Settings } from '@scbrowser/shared'
import { api } from '../api'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const WORK_WEEK = [1, 2, 3, 4, 5]

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <div>
        <h2 className="px-1 text-2xs font-semibold tracking-[0.06em] text-text-muted uppercase">{title}</h2>
        {hint && <p className="px-1 pt-1 text-xs text-text-faint">{hint}</p>}
      </div>
      <div className="sc-glass-strong flex flex-col gap-2 rounded-xl p-3 shadow-1">{children}</div>
    </section>
  )
}

/** A list of short text entries, with a box to add more. */
function ListEditor({ label, placeholder, items, clean, onChange }: { label: string; placeholder: string; items: string[]; clean: (text: string) => string | null; onChange: (items: string[]) => void }) {
  const [draft, setDraft] = useState('')
  const value = clean(draft)
  return (
    <>
      {items.map((item) => (
        <div key={item} className="flex items-center justify-between gap-2">
          <span className="min-w-0 truncate">{item}</span>
          <IconButton size="sm" label={`Remove ${item}`} onClick={() => onChange(items.filter((other) => other !== item))}>
            <X size={12} strokeWidth={2} />
          </IconButton>
        </div>
      ))}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (!value) return
          onChange([...new Set([...items, value])])
          setDraft('')
        }}
      >
        <Input aria-label={label} placeholder={placeholder} className="min-w-0 flex-1" value={draft} onChange={(e) => setDraft(e.target.value)} />
        <Button type="submit" disabled={!value}>
          Add
        </Button>
      </form>
    </>
  )
}

function RuleRow({ rule, onChange, onRemove }: { rule: BlockRule; onChange: (rule: BlockRule) => void; onRemove: () => void }) {
  return (
    <div className="flex flex-col gap-2 border-b border-border pb-2 last:border-b-0">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-medium">{rule.domain}</span>
        <Select aria-label={`When to block ${rule.domain}`} value={rule.when} onChange={(e) => onChange({ ...rule, when: e.target.value as BlockRule['when'] })}>
          <option value="always">Always</option>
          <option value="focus">In Focus Mode</option>
          <option value="schedule">At set times</option>
        </Select>
        <IconButton size="sm" label={`Remove ${rule.domain}`} onClick={onRemove}>
          <X size={12} strokeWidth={2} />
        </IconButton>
      </div>
      {rule.when === 'schedule' && (
        <div className="flex flex-wrap items-center gap-1">
          {DAYS.map((day, index) => {
            const on = rule.days.includes(index)
            return (
              <button
                key={day}
                type="button"
                aria-pressed={on}
                className={on ? 'h-7 rounded-sm bg-text px-2 text-xs text-surface' : 'h-7 rounded-sm px-2 text-xs text-text-muted shadow-1'}
                onClick={() => onChange({ ...rule, days: on ? rule.days.filter((d) => d !== index) : [...rule.days, index] })}
              >
                {day}
              </button>
            )
          })}
          <Input type="time" aria-label="From" className="ml-2" value={rule.start} onChange={(e) => e.target.value && onChange({ ...rule, start: e.target.value })} />
          <span className="text-text-muted">to</span>
          <Input type="time" aria-label="Until" value={rule.end} onChange={(e) => e.target.value && onChange({ ...rule, end: e.target.value })} />
        </div>
      )}
    </div>
  )
}

export function BlockerPage() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [domain, setDomain] = useState('')

  useEffect(() => {
    void api().invoke('settings:get').then(setSettings)
  }, [])
  if (!settings) return null

  const config = { ...DEFAULT_BLOCKER, ...settings.blocker }
  const setConfig = (patch: Partial<BlockerConfig>) => {
    const blocker = { ...config, ...patch }
    setSettings({ ...settings, blocker })
    void api().invoke('settings:set', { blocker })
  }
  const setFocus = (focusMode: boolean) => {
    setSettings({ ...settings, focusMode })
    void api().invoke('settings:set', { focusMode })
  }
  const addRule = () => {
    const site = toDomain(domain)
    if (!site) return
    const rule: BlockRule = { id: crypto.randomUUID(), domain: site, when: 'always', days: WORK_WEEK, start: '09:00', end: '17:00' }
    setConfig({ rules: [...config.rules.filter((r) => r.domain !== site), rule] })
    setDomain('')
  }

  return (
    <>
      <Section title="Blocker">
        <div className="flex items-center justify-between">
          <span>Site blocker</span>
          <Switch label="Site blocker" checked={config.enabled} onChange={(enabled) => setConfig({ enabled })} />
        </div>
        <div className="flex items-center justify-between">
          <span>Focus Mode</span>
          <Switch label="Focus Mode" checked={settings.focusMode} onChange={setFocus} />
        </div>
      </Section>

      <Section title="Blocked sites" hint="Subdomains count too. Blocking reddit.com also covers old.reddit.com.">
        {config.rules.map((rule) => (
          <RuleRow
            key={rule.id}
            rule={rule}
            onChange={(next) => setConfig({ rules: config.rules.map((r) => (r.id === rule.id ? next : r)) })}
            onRemove={() => setConfig({ rules: config.rules.filter((r) => r.id !== rule.id) })}
          />
        ))}
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            addRule()
          }}
        >
          <Input aria-label="Site to block" placeholder="example.com" className="min-w-0 flex-1" value={domain} onChange={(e) => setDomain(e.target.value)} />
          <Button type="submit" disabled={!toDomain(domain)}>
            Block
          </Button>
        </form>
      </Section>

      <Section title="Messages" hint="Shown on the block page. With several, one is picked at random.">
        <ListEditor label="New message" placeholder="Is this really what you meant to do?" items={config.messages} clean={(text) => text.trim().slice(0, 500) || null} onChange={(messages) => setConfig({ messages })} />
      </Section>

      <Section title="Site categories" hint="The AI checks each new site or subdomain against these, once. This uses AI tokens, and sends only the site's name.">
        <div className="flex items-center justify-between">
          <span>Check categories</span>
          <Select aria-label="Check categories" value={config.categoryMode} onChange={(e) => setConfig({ categoryMode: e.target.value as BlockerConfig['categoryMode'] })}>
            <option value="off">Never</option>
            <option value="focus">Only in Focus Mode</option>
            <option value="always">Always</option>
          </Select>
        </div>
        <ListEditor label="New category" placeholder="Social media" items={config.categories} clean={(text) => text.trim().slice(0, 80) || null} onChange={(categories) => setConfig({ categories })} />
      </Section>

      <Section title="Allowlist" hint="These sites always open, whatever the rules, categories or Focus Mode say.">
        <ListEditor label="Site to allow" placeholder="example.com" items={config.allowlist} clean={toDomain} onChange={(allowlist) => setConfig({ allowlist })} />
      </Section>
    </>
  )
}
