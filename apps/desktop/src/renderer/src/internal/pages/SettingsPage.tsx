import { useEffect, useState, type ReactNode } from 'react'
import { Button, Input, Select, Switch } from '@scbrowser/ui'
import {
  ACCENTS,
  PERMISSION_LABELS,
  SEARCH_ENGINES,
  TOOLBAR_ITEMS,
  TRANSLATE_LANGUAGES,
  type ImportResult,
  type ImportSource,
  type InternalCommands,
  type PermissionDecision,
  type Settings,
  type SitePermission,
  type ToolbarItemId
} from '@scbrowser/shared'
import { api } from '../api'

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-1">
      <h2 className="text-xs font-medium text-text-muted">{title}</h2>
      <div className="flex flex-col rounded-lg shadow-1">{children}</div>
    </section>
  )
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex min-h-12 items-center justify-between gap-6 border-b border-border px-3 py-2 last:border-b-0">
      <div className="min-w-0">
        <div>{label}</div>
        {hint && <div className="truncate text-xs text-text-faint">{hint}</div>}
      </div>
      {children}
    </div>
  )
}

export function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [permissions, setPermissions] = useState<PermissionDecision[]>([])
  const [isDefault, setIsDefault] = useState(false)
  const [offHosts, setOffHosts] = useState<string[]>([])
  const [sources, setSources] = useState<ImportSource[]>([])
  const [profiles, setProfiles] = useState<{ current: string; names: string[] }>({ current: '', names: [] })
  const [newProfile, setNewProfile] = useState('')
  const [imported, setImported] = useState<Record<string, ImportResult>>({})
  const [version, setVersion] = useState<ReturnType<InternalCommands['browser:version']> | null>(null)

  useEffect(() => {
    void api().invoke('settings:get').then(setSettings)
    void api().invoke('permissions:list').then(setPermissions)
    void api().invoke('browser:is-default').then(setIsDefault)
    void api().invoke('privacy:off-hosts').then(setOffHosts)
    void api().invoke('import:sources').then(setSources)
    void api().invoke('profiles:list').then(setProfiles)
    void api().invoke('browser:version').then(setVersion)
  }, [])

  if (!settings) return null

  const update = (patch: Partial<Settings>) => {
    setSettings({ ...settings, ...patch })
    void api().invoke('settings:set', patch)
  }
  const toggleToolbarItem = (id: ToolbarItemId, show: boolean) => {
    const others = settings.hiddenToolbarItems.filter((item) => item !== id)
    update({ hiddenToolbarItems: show ? others : [...others, id] })
  }
  const engine = SEARCH_ENGINES.find((e) => e.id === settings.searchEngine)

  return (
    <>
      <Section title="Appearance">
        <Row label="Theme">
          <Select
            aria-label="Theme"
            value={settings.theme}
            onChange={(e) => update({ theme: e.target.value as Settings['theme'] })}
          >
            <option value="system">Match system</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </Select>
        </Row>
        <Row label="Accent colour">
          <Select
            aria-label="Accent colour"
            value={settings.accent}
            onChange={(e) => {
              const accent = e.target.value as Settings['accent']
              document.documentElement.dataset.accent = accent
              update({ accent })
            }}
          >
            {ACCENTS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </Select>
        </Row>
        <Row label="Tab layout">
          <Select
            aria-label="Tab layout"
            value={settings.tabLayout}
            onChange={(e) => update({ tabLayout: e.target.value as Settings['tabLayout'] })}
          >
            <option value="horizontal">Across the top</option>
            <option value="vertical">Down the side</option>
          </Select>
        </Row>
        <Row label="Bookmarks bar">
          <Switch
            label="Bookmarks bar"
            checked={settings.showBookmarksBar}
            onChange={(showBookmarksBar) => update({ showBookmarksBar })}
          />
        </Row>
      </Section>

      <Section title="Toolbar">
        {TOOLBAR_ITEMS.map((item) => (
          <Row key={item.id} label={item.name}>
            <Switch
              label={`Show ${item.name}`}
              checked={!settings.hiddenToolbarItems.includes(item.id)}
              onChange={(show) => toggleToolbarItem(item.id, show)}
            />
          </Row>
        ))}
      </Section>

      <Section title="Privacy">
        <Row label="Tracking protection" hint="Blocks ads and trackers. Filter lists download once and refresh when needed.">
          <Select
            aria-label="Tracking protection"
            value={settings.trackingProtection}
            onChange={(e) => update({ trackingProtection: e.target.value as Settings['trackingProtection'] })}
          >
            <option value="off">Off</option>
            <option value="standard">Standard</option>
            <option value="strict">Strict, also hides annoyances</option>
          </Select>
        </Row>
        <Row label="HTTPS-only mode" hint="Moves sites to secure connections, and asks before using an insecure one.">
          <Switch label="HTTPS-only mode" checked={settings.httpsOnly} onChange={(httpsOnly) => update({ httpsOnly })} />
        </Row>
        {offHosts.map((host) => (
          <Row key={host} label={host} hint="Tracking protection is off">
            <Button
              variant="ghost"
              onClick={() => {
                void api().invoke('privacy:toggle-site', host)
                setOffHosts(offHosts.filter((h) => h !== host))
              }}
            >
              Turn on
            </Button>
          </Row>
        ))}
      </Section>

      <Section title="Search">
        <Row label="Search engine">
          <Select
            aria-label="Search engine"
            value={settings.searchEngine}
            onChange={(e) => update({ searchEngine: e.target.value })}
          >
            {SEARCH_ENGINES.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </Select>
        </Row>
        <Row
          label="Search suggestions"
          hint={
            engine?.suggestTemplate
              ? `Sends what you type in the address bar to ${engine.name}`
              : `${engine?.name ?? 'This engine'} doesn't offer suggestions`
          }
        >
          <Switch
            label="Search suggestions"
            checked={settings.searchSuggestions}
            onChange={(searchSuggestions) => update({ searchSuggestions })}
          />
        </Row>
      </Section>

      <Section title="Startup and performance">
        <Row label="When scDelta starts">
          <Select
            aria-label="When scDelta starts"
            value={settings.startup}
            onChange={(e) => update({ startup: e.target.value as Settings['startup'] })}
          >
            <option value="restore">Reopen previous tabs</option>
            <option value="new-tab">Open a new tab</option>
          </Select>
        </Row>
        <Row label="Sleep background tabs" hint="Frees memory. Tabs reload when you open them.">
          <Select
            aria-label="Sleep background tabs"
            value={settings.sleepAfterMinutes}
            onChange={(e) => update({ sleepAfterMinutes: Number(e.target.value) })}
          >
            <option value={0}>Never</option>
            <option value={15}>After 15 minutes</option>
            <option value={30}>After 30 minutes</option>
            <option value={60}>After 1 hour</option>
            <option value={120}>After 2 hours</option>
          </Select>
        </Row>
      </Section>

      <Section title="Downloads">
        <Row label="Save files to" hint={settings.downloadDir || 'Downloads folder'}>
          <Button
            onClick={() =>
              void api()
                .invoke('settings:pick-download-dir')
                .then((downloadDir) => downloadDir && update({ downloadDir }))
            }
          >
            Change
          </Button>
        </Row>
        <Row label="Ask where to save each file">
          <Switch
            label="Ask where to save each file"
            checked={settings.askWhereToSave}
            onChange={(askWhereToSave) => update({ askWhereToSave })}
          />
        </Row>
      </Section>

      <Section title="Assistant">
        <Row label="Keep chats on this device" hint="Page text sent with a message isn't kept.">
          <Switch label="Keep chats on this device" checked={settings.saveChats} onChange={(saveChats) => update({ saveChats })} />
        </Row>
        <Row label="Translate pages into">
          <Select
            aria-label="Translate pages into"
            value={settings.translateTo}
            onChange={(e) => update({ translateTo: e.target.value as Settings['translateTo'] })}
          >
            {TRANSLATE_LANGUAGES.map((language) => (
              <option key={language}>{language}</option>
            ))}
          </Select>
        </Row>
        <Row label="Saved chats">
          <Button variant="ghost" onClick={() => void api().invoke('chats:clear')}>
            Delete all
          </Button>
        </Row>
      </Section>

      <Section title="Site permissions">
        {permissions.length === 0 && <Row label="No sites have asked for permissions yet">{null}</Row>}
        {permissions.map(({ origin, permission, allowed }) => (
          <Row
            key={`${origin}:${permission}`}
            label={origin}
            hint={`${allowed ? 'Allowed' : 'Blocked'} to ${PERMISSION_LABELS[permission as SitePermission]}`}
          >
            <Button
              variant="ghost"
              onClick={() => {
                void api().invoke('permissions:revoke', origin, permission)
                setPermissions(permissions.filter((p) => !(p.origin === origin && p.permission === permission)))
              }}
            >
              Reset
            </Button>
          </Row>
        ))}
      </Section>

      <Section title="Profiles">
        {profiles.names.map((name) => (
          <Row key={name} label={name} hint={name === profiles.current ? 'This window' : 'Separate tabs, history, bookmarks and logins'}>
            {name !== profiles.current && (
              <Button variant="ghost" onClick={() => void api().invoke('profiles:open', name)}>
                Open
              </Button>
            )}
          </Row>
        ))}
        <Row label="New profile">
          <div className="flex gap-2">
            <Input aria-label="Profile name" placeholder="Name" value={newProfile} onChange={(e) => setNewProfile(e.target.value)} />
            <Button
              disabled={!/^[\w -]{1,40}$/.test(newProfile.trim())}
              onClick={() => {
                void api().invoke('profiles:open', newProfile.trim())
                setNewProfile('')
              }}
            >
              Create and open
            </Button>
          </div>
        </Row>
      </Section>

      <Section title="Import">
        {sources.length === 0 && <Row label="No other browsers found on this computer">{null}</Row>}
        {sources.map((source) => (
          <Row
            key={source.id}
            label={source.name}
            hint={
              imported[source.id]
                ? `Added ${imported[source.id]!.bookmarks} bookmarks and ${imported[source.id]!.history} history entries`
                : 'Bookmarks and history. Passwords are not imported.'
            }
          >
            <Button
              onClick={() =>
                void api()
                  .invoke('import:run', source.id)
                  .then((result) => setImported((all) => ({ ...all, [source.id]: result })))
              }
            >
              Import
            </Button>
          </Row>
        ))}
      </Section>

      <Section title="About">
        <Row label="Default browser" hint={isDefault ? 'scDelta is your default browser' : undefined}>
          {!isDefault && (
            <Button
              onClick={() =>
                void api()
                  .invoke('browser:set-default')
                  .then(() => api().invoke('browser:is-default'))
                  .then(setIsDefault)
              }
            >
              Make default
            </Button>
          )}
        </Row>
        {version && <Row label={`scDelta ${version.app}`} hint={`Chromium ${version.chromium}, Electron ${version.electron}`}>{null}</Row>}
      </Section>
    </>
  )
}
