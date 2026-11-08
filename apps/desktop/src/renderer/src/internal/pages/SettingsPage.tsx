import { Search, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Button, Input, Select, Switch } from '@scbrowser/ui'
import {
  ACCENTS,
  ARCHIVE_CHOICES,
  DEFAULT_SETTINGS,
  PERFORMANCE_SLEEP_MINUTES,
  PERMISSION_LABELS,
  SEARCH_ENGINES,
  SUGGESTION_SOURCES,
  TOOLBAR_ITEMS,
  TOOLBAR_SLOTS,
  TRANSLATE_LANGUAGES,
  cleanRuleMatch,
  type CrashEntry,
  type DownloadRule,
  type ExtensionInfo,
  type ImportResult,
  type ImportSource,
  type InternalCommands,
  type PermissionDecision,
  type Settings,
  type SitePermission,
  type SyncStatus,
  type UpdateState,
  type WebApp
} from '@scbrowser/shared'
import { api, applyPerformance, applyTint } from '../api'
import { ConfirmButton } from '../ConfirmButton'
import { announceSearching, openSettingsGroup, SETTINGS_GROUPS, useSettingsGroup, type SettingsGroupId } from '../settingsGroups'
import { ChipToggles, Group, Row, RowSelect, Searchable, SearchProvider, searchWords, Section } from '../settingsParts'
import { ForgetOnClose, MiniAppsSection, PageTweaks } from './SiteSettings'

export { SETTINGS_GROUPS } from '../settingsGroups'

type Update = (patch: Partial<Settings>) => void

function languageName(code: string): string {
  try {
    return new Intl.DisplayNames(undefined, { type: 'language' }).of(code) ?? code
  } catch {
    return code
  }
}

const open = (address: string) => void api().invoke('browser:open', address)

/** A row that only leads to another scTerra page. */
function LinkRow({ label, hint, address, keywords }: { label: string; hint: string; address: string; keywords?: string }) {
  return (
    <Row label={label} hint={hint} keywords={keywords}>
      <Button onClick={() => open(address)}>Open</Button>
    </Row>
  )
}

const UPDATE_WORDS: Record<UpdateState['phase'], string> = {
  idle: 'Updates arrive in the background.',
  checking: 'Checking for a new version…',
  current: 'You have the latest version.',
  available: 'Downloading a new version…',
  downloading: 'Downloading a new version…',
  ready: 'A new version is ready.',
  manual: 'A new version is available to download.',
  installing: 'Installing the update…',
  error: "Couldn't check for updates."
}

function UpdatesSection({ settings, update }: { settings: Settings; update: Update }) {
  const [state, setState] = useState<UpdateState | null>(null)
  const busy = state?.phase === 'checking' || state?.phase === 'available' || state?.phase === 'downloading' || state?.phase === 'installing'
  useEffect(() => {
    const refresh = () => void api().invoke('updates:state').then(setState)
    refresh()
    // Quickly while something is happening, so the progress moves; otherwise now and then.
    const timer = setInterval(refresh, busy ? 1000 : 5000)
    return () => clearInterval(timer)
  }, [busy])
  if (!state) return null
  const hint =
    state.phase === 'downloading' && state.percent !== null
      ? `Downloading version ${state.version ?? ''}, ${state.percent}%`
      : state.phase === 'ready' || state.phase === 'manual'
        ? `Version ${state.version} is ready.`
        : (state.error ?? UPDATE_WORDS[state.phase])
  return (
    <Section title="Updates">
      {state.supported ? (
        <>
          <Row setting="autoUpdate" label="Update automatically" hint="Downloads new versions in the background.">
            <Switch label="Update automatically" checked={settings.autoUpdate} onChange={(autoUpdate) => update({ autoUpdate })} />
          </Row>
          <Row label="Version" hint={hint} keywords="update check">
            {state.phase === 'ready' || state.phase === 'manual' ? (
              <Button variant="primary" onClick={() => void api().invoke('updates:install')}>
                {state.phase === 'ready' ? 'Restart to update' : 'Get it'}
              </Button>
            ) : (
              <Button disabled={busy} onClick={() => void api().invoke('updates:check').then(setState)}>
                Check now
              </Button>
            )}
          </Row>
        </>
      ) : (
        <Row label="Updates" hint="This copy can't update itself. Install a release to get updates." />
      )}
    </Section>
  )
}

function SearchBox({ query, setQuery }: { query: string; setQuery: (query: string) => void }) {
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    // "/" jumps to the search, as on many sites, unless someone is already typing somewhere.
    const onKey = (event: KeyboardEvent) => {
      const typing = event.target instanceof HTMLElement && (event.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName))
      if (event.key === '/' && !typing && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault()
        input.current?.focus()
      }
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [])
  return (
    <div role="search" className="relative">
      <Search aria-hidden size={14} strokeWidth={1.75} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-text-faint" />
      <Input
        ref={input}
        type="search"
        aria-label="Search settings"
        placeholder="Search settings"
        className="h-9 w-full pr-8 pl-8 [&::-webkit-search-cancel-button]:hidden"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && query) {
            e.preventDefault()
            setQuery('')
          }
        }}
      />
      {query && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => {
            setQuery('')
            input.current?.focus()
          }}
          className="absolute top-1/2 right-1.5 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-text-faint hover:bg-surface-hover hover:text-text"
        >
          <X aria-hidden size={13} strokeWidth={2} />
        </button>
      )}
    </div>
  )
}

export function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [query, setQuery] = useState('')
  const [changedOnly, setChangedOnly] = useState(false)
  const [nothingFound, setNothingFound] = useState(false)
  const group = useSettingsGroup()
  const results = useRef<HTMLDivElement>(null)
  const words = searchWords(query)
  // Searching, or listing what's changed, shows matches from every page at once.
  const filtering = words.length > 0 || changedOnly

  useEffect(() => void api().invoke('settings:get').then(setSettings), [])
  // Picking a page in the sidebar leaves the search.
  useEffect(() => {
    setQuery('')
    setChangedOnly(false)
  }, [group])
  useEffect(() => announceSearching(filtering), [filtering])
  useLayoutEffect(() => setNothingFound(filtering && !results.current?.querySelector('[data-setting]')))

  if (!settings) return null

  const update: Update = (patch) => {
    // From the latest state, so two quick changes in a row both stick.
    setSettings((current) => (current ? { ...current, ...patch } : current))
    void api().invoke('settings:set', patch)
  }
  const reset = (key: keyof Settings) => {
    const value = DEFAULT_SETTINGS[key]
    // Some settings also change how this page looks, straight away.
    if (key === 'accent') document.documentElement.dataset.accent = value as Settings['accent']
    if (key === 'accentTint') applyTint(value as boolean)
    if (key === 'performanceMode') applyPerformance(value as boolean)
    update({ [key]: value })
  }
  const shows = (id: SettingsGroupId) => filtering || group === id
  const props = { settings, update }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex gap-2">
        <div className="min-w-0 flex-1">
          <SearchBox query={query} setQuery={setQuery} />
        </div>
        <Button aria-pressed={changedOnly} className={changedOnly ? 'h-9 shrink-0 border border-accent bg-accent-soft text-text shadow-none' : 'h-9 shrink-0'} onClick={() => setChangedOnly(!changedOnly)}>
          Changed
        </Button>
        {/* The sidebar shows only icons in a narrow window, without the pages of Settings. */}
        <Select aria-label="Settings page" className="h-9 shrink-0 min-[721px]:hidden" value={group} onChange={(e) => openSettingsGroup(e.target.value as SettingsGroupId)}>
          {SETTINGS_GROUPS.map(({ id, title }) => (
            <option key={id} value={id}>
              {title}
            </option>
          ))}
        </Select>
      </div>
      <SearchProvider words={words} values={{ values: settings, changedOnly, reset }}>
        <div ref={results} data-settings-searching={filtering ? '' : undefined} className="flex flex-col gap-10">
          {SETTINGS_GROUPS.filter(({ id }) => shows(id)).map(({ id, title }) => {
            const Page = GROUP_PAGES[id]
            return (
              <Group key={id} id={id} title={title}>
                <Page {...props} />
              </Group>
            )
          })}
        </div>
      </SearchProvider>
      {nothingFound && (
        <p role="status" className="text-text-muted">
          {words.length > 0 ? `No ${changedOnly ? 'changed ' : ''}settings match “${query.trim()}”.` : 'Everything is as scTerra comes. Settings you change show up here, each with a button to put it back.'}
        </p>
      )}
    </div>
  )
}

function AppearancePage({ settings, update }: { settings: Settings; update: Update }) {
  return (
    <>
      <Section title="Theme">
        <Row setting="theme" label="Theme" keywords="colour scheme dark light mode night">
          <RowSelect aria-label="Theme" value={settings.theme} onChange={(e) => update({ theme: e.target.value as Settings['theme'] })}>
            <option value="system">Match system</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </RowSelect>
        </Row>
        <Row setting="accent" label="Accent colour" keywords="color highlight">
          <RowSelect
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
          </RowSelect>
        </Row>
        <Row setting="accentTint" label="Accent tint" hint="A faint wash of colour behind the toolbar and scTerra's pages." keywords="color">
          <Switch
            label="Accent tint"
            checked={settings.accentTint}
            onChange={(accentTint) => {
              applyTint(accentTint)
              update({ accentTint })
            }}
          />
        </Row>
      </Section>
      <Section title="Bookmarks">
        <Row setting="bookmarksBar" label="Show bookmarks" keywords="bar favourites favorites">
          <RowSelect aria-label="Show bookmarks bar" value={settings.bookmarksBar} onChange={(e) => update({ bookmarksBar: e.target.value as Settings['bookmarksBar'] })}>
            <option value="always">Always</option>
            <option value="new-tab">On new tabs</option>
            <option value="bookmarks-page">Only on the bookmarks page</option>
          </RowSelect>
        </Row>
        <Row setting="bookmarksLayout" label="Layout" hint={settings.bookmarksLayout === 'vertical' ? 'Icons and folders down the side, like Arc and Dia.' : 'A row under the toolbar.'} keywords="bar vertical horizontal side">
          <RowSelect aria-label="Bookmarks layout" value={settings.bookmarksLayout} onChange={(e) => update({ bookmarksLayout: e.target.value as Settings['bookmarksLayout'] })}>
            <option value="horizontal">Along the top</option>
            <option value="vertical">Down the side</option>
          </RowSelect>
        </Row>
      </Section>
      <Section title="New tab page">
        <Row label="Widgets, background and layout" keywords="wallpaper picture clock shortcuts">
          <Button onClick={() => open('sc://newtab/?customise=1')}>Customise</Button>
        </Row>
      </Section>
      <Section title="Page tweaks" description="Parts of sites you've hidden, and your own CSS for them." keywords="hide element css style">
        <Searchable text={`hidden parts own css ${Object.keys(settings.hiddenElements).join(' ')} ${Object.keys(settings.siteCss).join(' ')}`}>
          <PageTweaks settings={settings} update={update} />
        </Searchable>
      </Section>
    </>
  )
}

function TabsPage({ settings, update }: { settings: Settings; update: Update }) {
  return (
    <>
      <Section title="Tabs">
        <Row setting="tabLayout" label="Tab layout" keywords="vertical horizontal side">
          <RowSelect aria-label="Tab layout" value={settings.tabLayout} onChange={(e) => update({ tabLayout: e.target.value as Settings['tabLayout'] })}>
            <option value="horizontal">Across the top</option>
            <option value="vertical">Down the side</option>
          </RowSelect>
        </Row>
        <Row setting="tabSleepButton" label="Sleep button on tabs" hint="A moon beside each tab's close button puts it to sleep, freeing its memory until you open it again.">
          <Switch label="Sleep button on tabs" checked={settings.tabSleepButton} onChange={(tabSleepButton) => update({ tabSleepButton })} />
        </Row>
        <Row setting="linkPreview" label="Preview links with Shift-click" hint="Opens the link over the page, to read without making a tab. Open it as a tab from there if you want to keep it." keywords="peek">
          <Switch label="Preview links with Shift-click" checked={settings.linkPreview} onChange={(linkPreview) => update({ linkPreview })} />
        </Row>
      </Section>
      <Section title="Toolbar">
        <Row setting="hiddenToolbarItems" label="Buttons" hint="Choose which to show." keywords={TOOLBAR_ITEMS.map((item) => item.name).join(' ')}>
          <ChipToggles
            label="Toolbar buttons"
            options={TOOLBAR_ITEMS}
            isOn={(id) => !settings.hiddenToolbarItems.includes(id)}
            onToggle={(id, show) => {
              const others = settings.hiddenToolbarItems.filter((item) => item !== id)
              update({ hiddenToolbarItems: show ? others : [...others, id] })
            }}
          />
        </Row>
        <Row label="Arrange the toolbar" hint="Drag any button in the toolbar to a new place." keywords="order move">
          <Button variant="ghost" disabled={settings.toolbarOrder.join() === TOOLBAR_SLOTS.join()} onClick={() => update({ toolbarOrder: [...TOOLBAR_SLOTS] })}>
            Reset
          </Button>
        </Row>
        <Row setting="profilesButton" label="Profiles button" hint="Adds a button beside the assistant for switching profiles.">
          <Switch label="Show profiles in the toolbar" checked={settings.profilesButton} onChange={(profilesButton) => update({ profilesButton })} />
        </Row>
      </Section>
    </>
  )
}

function SearchPage({ settings, update }: { settings: Settings; update: Update }) {
  const engine = SEARCH_ENGINES.find((e) => e.id === settings.searchEngine)
  return (
    <>
      <Section title="Search engine">
        <Row setting="searchEngine" label="Search with" keywords="search engine default google duckduckgo bing">
          <RowSelect aria-label="Search engine" value={settings.searchEngine} onChange={(e) => update({ searchEngine: e.target.value })}>
            {SEARCH_ENGINES.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </RowSelect>
        </Row>
        <Row setting="searchSuggestions" label="Search suggestions" hint={engine?.suggestTemplate ? `Sends what you type in the address bar to ${engine.name}.` : `${engine?.name ?? 'This engine'} doesn't offer suggestions.`}>
          <Switch label="Search suggestions" checked={settings.searchSuggestions} onChange={(searchSuggestions) => update({ searchSuggestions })} />
        </Row>
      </Section>
      <Section title="Address bar">
        <Row setting="suggestionSources" label="Also suggest" hint="What the address bar offers as you type." keywords={`omnibox ${SUGGESTION_SOURCES.map((source) => source.name).join(' ')}`}>
          <ChipToggles
            label="Address bar suggestions"
            options={SUGGESTION_SOURCES}
            isOn={(id) => settings.suggestionSources.includes(id)}
            onToggle={(id, on) => update({ suggestionSources: on ? [...settings.suggestionSources, id] : settings.suggestionSources.filter((other) => other !== id) })}
          />
        </Row>
      </Section>
    </>
  )
}

const RULE_KIND_WORDS = { type: 'files', site: 'from' } as const

/** Folders for some downloads: a kind of file, or anything from a site. The first rule that fits wins. */
function DownloadRulesEditor({ settings, update }: { settings: Settings; update: Update }) {
  const [kind, setKind] = useState<DownloadRule['kind']>('type')
  const [match, setMatch] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const rules = settings.downloadRules
  return (
    <div className="flex flex-col divide-y divide-border">
      {rules.map((rule, index) => (
        <div key={`${rule.kind}:${rule.match}`} className="flex min-h-11 flex-wrap items-center justify-between gap-x-6 gap-y-1 px-3 py-2">
          <div className="min-w-0 flex-1 basis-48 [overflow-wrap:anywhere]">
            <div>{rule.kind === 'type' ? `.${rule.match} ${RULE_KIND_WORDS.type}` : `${RULE_KIND_WORDS.site} ${rule.match}`}</div>
            <div className="text-xs text-text-faint">{rule.folder}</div>
          </div>
          <Button variant="ghost" onClick={() => update({ downloadRules: rules.filter((_, other) => other !== index) })}>
            Remove
          </Button>
        </div>
      ))}
      <form
        className="flex flex-wrap items-center gap-2 px-3 py-2"
        onSubmit={(e) => {
          e.preventDefault()
          const clean = cleanRuleMatch(kind, match)
          if (!clean) return setProblem(kind === 'type' ? 'Enter a file type, like pdf' : 'Enter a site, like example.com')
          setProblem(null)
          void api()
            .invoke('settings:pick-download-dir')
            .then((folder) => {
              if (!folder) return
              update({ downloadRules: [...rules.filter((rule) => !(rule.kind === kind && rule.match === clean)), { kind, match: clean, folder }] })
              setMatch('')
            })
        }}
      >
        <Select aria-label="Rule for" className="w-32 shrink-0" value={kind} onChange={(e) => setKind(e.target.value as DownloadRule['kind'])}>
          <option value="type">File type</option>
          <option value="site">Site</option>
        </Select>
        <Input aria-label={kind === 'type' ? 'File type' : 'Site'} placeholder={kind === 'type' ? 'pdf' : 'example.com'} className="min-w-0 flex-1" value={match} onChange={(e) => setMatch(e.target.value)} aria-invalid={!!problem} />
        <Button type="submit" disabled={!match.trim()}>
          Choose folder
        </Button>
        {problem && (
          <span role="alert" className="w-full text-xs text-danger">
            {problem}
          </span>
        )}
      </form>
    </div>
  )
}

function BrowsingPage({ settings, update }: { settings: Settings; update: Update }) {
  const [spellLanguages, setSpellLanguages] = useState<string[]>([])
  useEffect(() => void api().invoke('spelling:languages').then(setSpellLanguages), [])
  return (
    <>
      <Section title="Startup">
        <Row setting="startup" label="When scTerra starts" keywords="restore session open">
          <RowSelect aria-label="When scTerra starts" value={settings.startup} onChange={(e) => update({ startup: e.target.value as Settings['startup'] })}>
            <option value="restore">Reopen previous tabs</option>
            <option value="new-tab">Open a new tab</option>
          </RowSelect>
        </Row>
      </Section>
      <Section title="Downloads">
        <Row setting="downloadDir" label="Save files to" hint={settings.downloadDir || 'Downloads folder'} keywords="folder location">
          <Button onClick={() => void api().invoke('settings:pick-download-dir').then((downloadDir) => downloadDir && update({ downloadDir }))}>Change</Button>
        </Row>
        <Row setting="askWhereToSave" label="Ask where to save each file">
          <Switch label="Ask where to save each file" checked={settings.askWhereToSave} onChange={(askWhereToSave) => update({ askWhereToSave })} />
        </Row>
      </Section>
      <Section title="Download rules" description="Send some downloads to a folder of their own, by kind of file or by the site they come from." keywords="downloads folder sort organise pdf">
        <Searchable text={`rules folder ${settings.downloadRules.map((rule) => `${rule.match} ${rule.folder}`).join(' ')}`}>
          <DownloadRulesEditor settings={settings} update={update} />
        </Searchable>
      </Section>
      <Section title="Spelling">
        <Row setting="spellCheck" label="Check spelling" hint="The dictionary is downloaded once from Google. What you type stays on this computer." keywords="spell checker">
          <Switch label="Check spelling" checked={settings.spellCheck} onChange={(spellCheck) => update({ spellCheck })} />
        </Row>
        {spellLanguages.length > 0 && settings.spellCheck && (
          <Row setting="spellLanguage" label="Language" keywords="dictionary">
            <RowSelect aria-label="Spelling language" value={settings.spellLanguage} onChange={(e) => update({ spellLanguage: e.target.value })}>
              <option value="">Same as this computer</option>
              {spellLanguages.map((code) => (
                <option key={code} value={code}>
                  {languageName(code)}
                </option>
              ))}
            </RowSelect>
          </Row>
        )}
      </Section>
    </>
  )
}

function PerformancePage({ settings, update }: { settings: Settings; update: Update }) {
  return (
    <>
      <Section title="Performance Mode">
        <Row setting="performanceMode" label="Performance Mode" hint={`Background tabs sleep after ${PERFORMANCE_SLEEP_MINUTES} minutes, newly opened pages wait for a press before playing sound or video, and scTerra drops its animations and blur.`} keywords="speed fast slow battery animations">
          <Switch
            label="Performance Mode"
            checked={settings.performanceMode}
            onChange={(performanceMode) => {
              applyPerformance(performanceMode)
              update({ performanceMode })
            }}
          />
        </Row>
      </Section>
      <Section title="Memory" keywords="ram">
        <Row setting="sleepAfterMinutes" label="Sleep background tabs" hint={settings.performanceMode ? `Performance Mode sleeps tabs within ${PERFORMANCE_SLEEP_MINUTES} minutes while it's on.` : 'Frees memory. Tabs reload when you open them.'} keywords="discard unload">
          <RowSelect aria-label="Sleep background tabs" value={settings.sleepAfterMinutes} onChange={(e) => update({ sleepAfterMinutes: Number(e.target.value) })}>
            <option value={0}>Never</option>
            <option value={15}>After 15 minutes</option>
            <option value={30}>After 30 minutes</option>
            <option value={60}>After 1 hour</option>
            <option value={120}>After 2 hours</option>
          </RowSelect>
        </Row>
        <Row setting="memorySaver" label="Memory saver" hint="When your computer runs low on memory, the background tabs you looked at longest ago sleep until there's room. Tabs playing sound and the ones you're using stay awake.">
          <Switch label="Memory saver" checked={settings.memorySaver} onChange={(memorySaver) => update({ memorySaver })} />
        </Row>
        <Row setting="archiveAfterDays" label="Archive unused tabs" hint="Closes tabs left unused and keeps them under Archived tabs, to bring back. Pinned and playing tabs stay." keywords="close old tabs">
          <RowSelect aria-label="Archive unused tabs" value={settings.archiveAfterDays} onChange={(e) => update({ archiveAfterDays: Number(e.target.value) as Settings['archiveAfterDays'] })}>
            {ARCHIVE_CHOICES.map((days) => (
              <option key={days} value={days}>
                {days === 0 ? 'Never' : days === 1 ? 'After a day unused' : `After ${days} days unused`}
              </option>
            ))}
          </RowSelect>
        </Row>
        <LinkRow label="Task Manager" hint="What each tab and part of scTerra is using." address="sc://tasks" keywords="cpu processes" />
      </Section>
    </>
  )
}

function PrivacyPage({ settings, update }: { settings: Settings; update: Update }) {
  const [permissions, setPermissions] = useState<PermissionDecision[]>([])
  const [offHosts, setOffHosts] = useState<string[]>([])
  const [crashes, setCrashes] = useState<CrashEntry[]>([])
  useEffect(() => {
    void api().invoke('permissions:list').then(setPermissions)
    void api().invoke('privacy:off-hosts').then(setOffHosts)
    void api().invoke('reports:list').then(setCrashes)
  }, [])
  return (
    <>
      <Section title="Protection">
        <Row setting="trackingProtection" label="Tracking protection" hint="Blocks ads and trackers. Filter lists download once and refresh when needed." keywords="ad blocker adblock">
          <RowSelect aria-label="Tracking protection" value={settings.trackingProtection} onChange={(e) => update({ trackingProtection: e.target.value as Settings['trackingProtection'] })}>
            <option value="off">Off</option>
            <option value="standard">Standard</option>
            <option value="strict">Strict, also hides annoyances</option>
          </RowSelect>
        </Row>
        <Row setting="httpsOnly" label="HTTPS-only mode" hint="Moves sites to secure connections, and asks before using an insecure one." keywords="secure ssl">
          <Switch label="HTTPS-only mode" checked={settings.httpsOnly} onChange={(httpsOnly) => update({ httpsOnly })} />
        </Row>
        <Row setting="rejectCookieBanners" label="Reject cookie banners" hint="Presses Reject or Only necessary on cookie banners for you. It never accepts. Sites with tracking protection off are left alone." keywords="consent gdpr">
          <Switch label="Reject cookie banners" checked={settings.rejectCookieBanners} onChange={(rejectCookieBanners) => update({ rejectCookieBanners })} />
        </Row>
        <Row setting="keepSignIns" label="Stay signed in after closing" hint="Some sites sign you in only until the browser closes. This keeps those sign-ins, as Chrome does when it continues where you left off. Applies to sign-ins from now on." keywords="cookies session login">
          <Switch label="Stay signed in after closing" checked={settings.keepSignIns} onChange={(keepSignIns) => update({ keepSignIns })} />
        </Row>
      </Section>
      {offHosts.length > 0 && (
        <Section title="Sites with tracking protection off" keywords="exceptions allowlist">
          {offHosts.map((host) => (
            <Row key={host} label={host}>
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
      )}
      <Section title="Forget when scTerra closes" description="Their cookies, site data and history are cleared each time scTerra closes." keywords="cookies clear data">
        <Searchable text={`sites cookies ${settings.forgetOnClose.join(' ')}`}>
          <ForgetOnClose settings={settings} update={update} />
        </Searchable>
      </Section>
      <Section title="Site permissions" keywords="camera microphone location notifications allowed blocked">
        {permissions.length === 0 && <Row label="No sites have asked for permissions yet" />}
        {permissions.map(({ origin, permission, allowed }) => (
          <Row
            key={`${origin}:${permission}`}
            label={origin}
            hint={permission.startsWith('app:') ? `Allowed to open ${permission.slice(4)}: links` : `${allowed ? 'Allowed' : 'Blocked'} to ${PERMISSION_LABELS[permission as SitePermission]}`}
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
      <Section title="More privacy tools">
        <LinkRow label="Passwords" hint="Saved logins, two-step codes, autofill and leak checks." address="sc://passwords" keywords="vault login autofill master password addresses" />
        <LinkRow label="Site blocker" hint="Block sites by time, Focus Mode or category." address="sc://blocker" keywords="focus study distractions" />
        <LinkRow label="VPN" hint="Send scTerra's traffic through your own connection." address="sc://vpn" keywords="proxy xray" />
      </Section>
      <Section title="Crash reports and usage" keywords="telemetry diagnostics">
        <Row setting="crashReports" label="Send crash reports" hint="The type of crash, the version and your operating system. Never pages, addresses or messages.">
          <Switch label="Send crash reports" checked={settings.crashReports} onChange={(crashReports) => update({ crashReports })} />
        </Row>
        <Row setting="usageStats" label="Send usage stats" hint="Once a day: only the version and your operating system.">
          <Switch label="Send usage stats" checked={settings.usageStats} onChange={(usageStats) => update({ usageStats })} />
        </Row>
        <Row label={crashes.length === 0 ? 'No crashes recorded' : `${crashes.length} ${crashes.length === 1 ? 'crash' : 'crashes'} recorded on this device`}>
          {crashes.length > 0 && (
            <Button
              variant="ghost"
              onClick={() => {
                void api().invoke('reports:clear')
                setCrashes([])
              }}
            >
              Clear
            </Button>
          )}
        </Row>
        {crashes.slice(0, 5).map((crash) => (
          <Row key={crash.at} label={`${crash.kind}: ${crash.reason}`} hint={new Date(crash.at).toLocaleString()} />
        ))}
      </Section>
    </>
  )
}

function SyncSection({ settings, update }: { settings: Settings; update: Update }) {
  const [sync, setSync] = useState<SyncStatus | null>(null)
  const [syncFolder, setSyncFolder] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [syncError, setSyncError] = useState<string | null>(null)
  useEffect(() => void api().invoke('sync:status').then(setSync), [])
  const ready = Boolean(syncFolder) && passphrase.length >= 10
  return (
    <Section title="Sync" description="Bookmarks, history and settings, encrypted into a folder you already sync, such as Syncthing or Dropbox.">
      {sync?.folder ? (
        <>
          <Row label={sync.folder} hint={sync.error ?? (sync.lastSync ? `Last synced ${new Date(sync.lastSync).toLocaleString()}` : 'Waiting for the first sync')}>
            <div className="flex gap-2">
              <Button onClick={() => void api().invoke('sync:run').then(setSync)}>Sync now</Button>
              <Button variant="ghost" onClick={() => void api().invoke('sync:disable').then(() => api().invoke('sync:status')).then(setSync)}>
                Turn off
              </Button>
            </div>
          </Row>
          <Row setting="syncHistory" label="Include history">
            <Switch label="Include history" checked={settings.syncHistory} onChange={(syncHistory) => update({ syncHistory })} />
          </Row>
        </>
      ) : (
        <>
          <Row label="Sync folder" hint={syncFolder || 'No folder chosen yet.'}>
            <Button onClick={() => void api().invoke('sync:pick-folder').then((folder) => folder && setSyncFolder(folder))}>Choose</Button>
          </Row>
          <Row label="Passphrase" hint="Use the same one on each device. It can't be recovered if it's lost.">
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                if (!ready) return
                setSyncError(null)
                void api()
                  .invoke('sync:enable', syncFolder, passphrase)
                  .then((status) => {
                    setSync(status)
                    setPassphrase('')
                  })
                  .catch((error: Error) => setSyncError(error.message.replace(/^.*Error: /, '')))
              }}
            >
              <Input aria-label="Sync passphrase" type="password" placeholder="10 characters or more" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} />
              <Button type="submit" disabled={!ready}>
                Turn on
              </Button>
            </form>
          </Row>
          {syncError && <Row label={syncError} tone="danger" />}
        </>
      )}
    </Section>
  )
}

function DataPage({ settings, update }: { settings: Settings; update: Update }) {
  const [sources, setSources] = useState<ImportSource[]>([])
  const [imported, setImported] = useState<Record<string, ImportResult>>({})
  const [importing, setImporting] = useState<string | null>(null)
  const [profiles, setProfiles] = useState<{ current: string; names: string[] }>({ current: '', names: [] })
  const [newProfile, setNewProfile] = useState('')
  useEffect(() => {
    void api().invoke('import:sources').then(setSources)
    void api().invoke('profiles:list').then(setProfiles)
  }, [])
  const profileName = newProfile.trim()
  const validName = /^[\w -]{1,40}$/.test(profileName)
  return (
    <>
      <SyncSection settings={settings} update={update} />
      <Section title="Import from another browser" keywords="chrome firefox edge brave migrate">
        {sources.length === 0 && <Row label="No other browsers found on this computer" />}
        {sources.map((source) => (
          <Row key={source.id} label={source.name} hint={imported[source.id] ? `Added ${imported[source.id]!.bookmarks} bookmarks and ${imported[source.id]!.history} history entries` : 'Bookmarks and history. Passwords are not imported.'}>
            <Button
              disabled={importing !== null}
              onClick={() => {
                setImporting(source.id)
                void api()
                  .invoke('import:run', source.id)
                  .then((result) => setImported((all) => ({ ...all, [source.id]: result })))
                  .finally(() => setImporting(null))
              }}
            >
              {importing === source.id ? 'Importing…' : 'Import'}
            </Button>
          </Row>
        ))}
      </Section>
      <Section title="Profiles" description="Each profile has its own tabs, history, bookmarks and logins." keywords="accounts people work personal">
        {profiles.names.map((name) => (
          <Row key={name} label={name} hint={name === profiles.current ? 'This window' : undefined}>
            {name !== profiles.current && (
              <Button variant="ghost" onClick={() => void api().invoke('profiles:open', name)}>
                Open
              </Button>
            )}
          </Row>
        ))}
        <Row label="New profile" hint={profileName && !validName ? 'Letters, numbers, spaces and dashes, up to 40.' : undefined}>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              if (!validName) return
              void api().invoke('profiles:open', profileName)
              setNewProfile('')
            }}
          >
            <Input aria-label="Profile name" placeholder="Name" value={newProfile} onChange={(e) => setNewProfile(e.target.value)} />
            <Button type="submit" disabled={!validName}>
              {profiles.names.includes(profileName) ? 'Open' : 'Create and open'}
            </Button>
          </form>
        </Row>
      </Section>
    </>
  )
}

function ExtensionsSection({ settings, update }: { settings: Settings; update: Update }) {
  const [extensions, setExtensions] = useState<ExtensionInfo[]>([])
  const [extensionError, setExtensionError] = useState<string | null>(null)
  useEffect(() => void api().invoke('extensions:list').then(setExtensions), [])
  return (
    <Section title="Extensions" keywords="add-ons addons plugins chrome">
      {extensions.map((extension) => (
        <Row key={extension.id} label={extension.name} hint={`Version ${extension.version}${extension.newTab ? '. Shows its own new tab page' : ''}`}>
          <div className="flex items-center gap-2">
            <Switch
              label={`Turn on ${extension.name}`}
              checked={extension.enabled}
              onChange={(enabled) => {
                setExtensions((all) => all.map((e) => (e.id === extension.id ? { ...e, enabled } : e)))
                void api().invoke('extensions:set-enabled', extension.id, enabled)
              }}
            />
            <ConfirmButton
              variant="ghost"
              confirmLabel="Remove it?"
              onConfirm={() => {
                void api().invoke('extensions:remove', extension.id)
                setExtensions((all) => all.filter((e) => e.id !== extension.id))
              }}
            >
              Remove
            </ConfirmButton>
          </div>
        </Row>
      ))}
      <Row label="Chrome Web Store" hint="Install most Chrome extensions, including password managers.">
        <Button onClick={() => void api().invoke('extensions:open-store')}>Open</Button>
      </Row>
      <Row label="Add an unpacked extension" hint="Choose a folder holding a Chrome extension." keywords="developer load">
        <Button
          onClick={() => {
            setExtensionError(null)
            void api()
              .invoke('extensions:add')
              .then(() => api().invoke('extensions:list'))
              .then(setExtensions)
              .catch(() => setExtensionError("That folder isn't a working extension."))
          }}
        >
          Add
        </Button>
      </Row>
      {extensionError && <Row label={extensionError} tone="danger" />}
      <Row setting="extensionDisplay" label="Open extensions in" hint={settings.extensionDisplay === 'panel' ? 'Popups, side panels and small windows all open under the Extensions button.' : 'The older way: side panels beside the page, and small windows of their own.'} keywords="popup">
        <RowSelect aria-label="Open extensions in" value={settings.extensionDisplay} onChange={(e) => update({ extensionDisplay: e.target.value as Settings['extensionDisplay'] })}>
          <option value="panel">A panel under the toolbar button</option>
          <option value="window">Their own windows and side panels</option>
        </RowSelect>
      </Row>
      <Row setting="extensionSidePanels" label="Side panels" hint={settings.extensionSidePanels === 'beside' ? 'Side panels, like Sider’s, stay open beside the page while you use it.' : 'Side panels open under the Extensions button, and close when you click the page.'}>
        <RowSelect aria-label="Side panels" value={settings.extensionSidePanels} onChange={(e) => update({ extensionSidePanels: e.target.value as Settings['extensionSidePanels'] })}>
          <option value="beside">Beside the page</option>
          <option value="popover">Under the toolbar button</option>
        </RowSelect>
      </Row>
    </Section>
  )
}

function InstalledApps() {
  const [apps, setApps] = useState<WebApp[]>([])
  useEffect(() => void api().invoke('apps:list').then(setApps), [])
  return (
    <Section title="Installed apps" keywords="pwa web apps sites windows">
      {apps.length === 0 && <Row label="No sites installed yet" hint="In a tab, open the More menu and choose Install this site as an app." />}
      {apps.map((entry) => (
        <Row key={entry.id} label={entry.name} hint={entry.url}>
          <div className="flex gap-2">
            <Button onClick={() => void api().invoke('apps:open', entry.url)}>Open</Button>
            <Button
              variant="ghost"
              onClick={() => {
                void api().invoke('apps:remove', entry.id)
                setApps(apps.filter((other) => other.id !== entry.id))
              }}
            >
              Remove
            </Button>
          </div>
        </Row>
      ))}
    </Section>
  )
}

function AiPage({ settings, update }: { settings: Settings; update: Update }) {
  return (
    <>
      <Section title="Assistant" keywords="ai chat">
        <LinkRow label="AI providers and models" hint="Add your own key, a model on this computer, or use scTerra AI." address="sc://ai" keywords="api key openai anthropic claude ollama skills" />
        <Row setting="saveChats" label="Keep chats on this device" hint="Page text sent with a message isn't kept." keywords="history save">
          <Switch label="Keep chats on this device" checked={settings.saveChats} onChange={(saveChats) => update({ saveChats })} />
        </Row>
        <Row label="Saved chats" keywords="delete clear">
          <ConfirmButton variant="ghost" onConfirm={() => void api().invoke('chats:clear')}>
            Delete all
          </ConfirmButton>
        </Row>
      </Section>
      <Section title="Translation" keywords="translate language">
        <Row setting="translateEngine" label="Translate with" hint={settings.translateEngine === 'google' ? "Free, with no key. The page's text goes to Google when you translate." : 'Uses your AI model and its credit, and only covers the start of long pages.'}>
          <RowSelect aria-label="Translate with" value={settings.translateEngine} onChange={(e) => update({ translateEngine: e.target.value as Settings['translateEngine'] })}>
            <option value="google">Google Translate</option>
            <option value="ai">Your AI model</option>
          </RowSelect>
        </Row>
        <Row setting="translateTo" label="Translate pages into">
          <RowSelect aria-label="Translate pages into" value={settings.translateTo} onChange={(e) => update({ translateTo: e.target.value as Settings['translateTo'] })}>
            {TRANSLATE_LANGUAGES.map((language) => (
              <option key={language}>{language}</option>
            ))}
          </RowSelect>
        </Row>
      </Section>
      <ExtensionsSection settings={settings} update={update} />
      <InstalledApps />
      <MiniAppsSection />
    </>
  )
}

function BackupSection() {
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null)
  return (
    <Section title="Back up settings" description="A file of your settings, to keep or to bring to another computer. Passwords, keys and history aren't in it." keywords="export import file backup restore transfer">
      <Row label="Export settings" hint={note && !note.error ? note.text : 'Saves a .json file.'}>
        <Button onClick={() => void api().invoke('settings:export').then((saved) => saved && setNote({ text: 'Saved.' }))}>Export</Button>
      </Row>
      <Row label="Import settings" hint="Replaces the settings the file holds. Folders and this computer's own choices stay.">
        <Button
          onClick={() => {
            setNote(null)
            void api()
              .invoke('settings:import')
              .then((count) => {
                if (count === null) return
                // The whole page reflects the new settings, including its colours.
                location.reload()
              })
              .catch((error: Error) => setNote({ text: error.message.replace(/^.*Error: /, ''), error: true }))
          }}
        >
          Import
        </Button>
      </Row>
      {note?.error && <Row label={note.text} tone="danger" />}
    </Section>
  )
}

function AboutPage({ settings, update }: { settings: Settings; update: Update }) {
  const [isDefault, setIsDefault] = useState(false)
  const [version, setVersion] = useState<ReturnType<InternalCommands['browser:version']> | null>(null)
  useEffect(() => {
    void api().invoke('browser:is-default').then(setIsDefault)
    void api().invoke('browser:version').then(setVersion)
  }, [])
  return (
    <>
      <UpdatesSection settings={settings} update={update} />
      <BackupSection />
      <Section title="scTerra">
        <Row label="Default browser" hint={isDefault ? 'scTerra is your default browser.' : 'Links from other apps open in another browser.'}>
          {!isDefault && (
            <Button onClick={() => void api().invoke('browser:set-default').then(() => api().invoke('browser:is-default')).then(setIsDefault)}>Make default</Button>
          )}
        </Row>
        {version && <Row label={`scTerra ${version.app}`} hint={`Chromium ${version.chromium}, Electron ${version.electron}`} keywords="version" />}
        <LinkRow label="Flags" hint="Experimental switches, and some just for fun." address="sc://flags" keywords="experiments labs" />
        <Row label="Welcome intro" hint="Browse the World.">
          <Button variant="ghost" onClick={() => void api().invoke('welcome:replay')}>
            Play again
          </Button>
        </Row>
        <Row label="Copyright" hint="All Rights Reserved. Bundled open source parts keep their own licences." keywords="licence license">
          <span className="text-xs text-text-muted">© 2026 sc-simpledev</span>
        </Row>
      </Section>
    </>
  )
}

const GROUP_PAGES: Record<SettingsGroupId, (props: { settings: Settings; update: Update }) => ReactNode> = {
  appearance: AppearancePage,
  tabs: TabsPage,
  search: SearchPage,
  browsing: BrowsingPage,
  performance: PerformancePage,
  privacy: PrivacyPage,
  data: DataPage,
  ai: AiPage,
  about: AboutPage
}
