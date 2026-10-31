import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { FiltersEngine, Request } from '@ghostery/adblocker'
import { app, type OnBeforeRequestListenerDetails, type Session, type WebContents } from 'electron'
import { httpsUpgrade, type Settings } from '@scbrowser/shared'
import type { SettingsStore } from '../settings'
import type { KeyValueRepo } from '../storage/kv'

const OFF_HOSTS = 'privacy:off-hosts'
const MAX_REMEMBERED_UPGRADES = 200
const ISOLATED_WORLD = 1002

/** The classes and ids on a page, which pick out the rules it needs. */
const READ_DOM = `(() => {
  const classes = new Set()
  const ids = new Set()
  for (const element of document.querySelectorAll('[class],[id]')) {
    for (const name of element.classList) classes.add(name)
    if (element.id) ids.add(element.id)
  }
  return { classes: [...classes], ids: [...ids] }
})()`

type Level = Settings['trackingProtection']

async function loadEngine(level: Level): Promise<FiltersEngine | null> {
  // Tests supply their own rules so they don't depend on downloading filter lists.
  if (process.env.SCB_FILTERS) return FiltersEngine.parse(process.env.SCB_FILTERS)
  if (level === 'off') return null
  const path = join(app.getPath('userData'), `filters-${level}.bin`)
  const caching = {
    path,
    read: async () => new Uint8Array(await readFile(path)),
    write: (_path: string, data: Uint8Array) => writeFile(path, data)
  }
  return level === 'strict'
    ? FiltersEngine.fromPrebuiltFull(fetch, caching)
    : FiltersEngine.fromPrebuiltAdsAndTracking(fetch, caching)
}

interface PrivacyOptions {
  onBlocked: (webContentsId: number) => void
  onChanged: () => void
}

/** Blocks ads and trackers at the network level, and moves pages onto HTTPS. */
export class PrivacyService {
  private engine: FiltersEngine | null = null
  private engineLevel: Level = 'off'
  /** Sites where the person chose plain HTTP after the upgrade failed. Forgotten on restart. */
  private readonly httpAllowed = new Set<string>()
  private readonly upgraded = new Map<string, string>()
  /** Checked on every request, so it's kept in memory rather than read from the database. */
  private readonly off: Set<string>

  constructor(
    private readonly settings: SettingsStore,
    private readonly kv: KeyValueRepo,
    private readonly options: PrivacyOptions
  ) {
    this.off = new Set((kv.get(OFF_HOSTS) as string[] | undefined) ?? [])
    void this.syncEngine()
    settings.subscribe(() => void this.syncEngine())
  }

  attach(session: Session): void {
    session.webRequest.onBeforeRequest((details, respond) => respond(this.decide(details)))
  }

  /** Hides ad placeholders on a page whose requests were blocked. No page scripts are added. */
  async applyCosmetics(contents: WebContents): Promise<void> {
    const url = contents.getURL()
    if (!this.engine || !/^https?:/i.test(url) || this.off.has(new URL(url).host)) return
    const { hostname, domain } = Request.fromRawDetails({ url, sourceUrl: url, type: 'mainFrame' })
    const dom = await contents
      .executeJavaScriptInIsolatedWorld(ISOLATED_WORLD, [{ code: READ_DOM }])
      .catch(() => null) as { classes: string[]; ids: string[] } | null
    if (!dom || contents.isDestroyed()) return
    const { styles } = this.engine.getCosmeticsFilters({
      url,
      hostname,
      domain,
      ...dom,
      getBaseRules: true,
      getInjectionRules: false,
      getExtendedRules: false,
      getRulesFromDOM: true
    })
    if (styles) await contents.insertCSS(styles, { cssOrigin: 'user' }).catch(() => undefined)
  }

  offHosts(): string[] {
    return [...this.off].sort()
  }

  toggleSite(host: string): void {
    if (!this.off.delete(host)) this.off.add(host)
    this.kv.set(OFF_HOSTS, this.offHosts())
    this.options.onChanged()
  }

  /** The original http:// address if this failed https:// address was our upgrade. */
  upgradedFrom(url: string): string | null {
    return this.upgraded.get(url) ?? null
  }

  allowHttp(url: string): void {
    if (URL.canParse(url)) this.httpAllowed.add(new URL(url).host)
  }

  private async syncEngine(): Promise<void> {
    const level = this.settings.get().trackingProtection
    if (level === this.engineLevel && (this.engine || level === 'off')) return
    this.engineLevel = level
    // If filter lists can't be fetched, browsing carries on without blocking until next time.
    const engine = await loadEngine(level).catch(() => null)
    if (this.engineLevel === level) this.engine = engine
  }

  private decide(details: OnBeforeRequestListenerDetails) {
    if (details.resourceType === 'mainFrame') {
      const target = this.settings.get().httpsOnly && !this.httpAllowed.has(new URL(details.url).host) ? httpsUpgrade(details.url) : null
      if (target) {
        this.rememberUpgrade(target, details.url)
        return { redirectURL: target }
      }
      return {}
    }
    return this.isBlocked(details) ? { cancel: true } : {}
  }

  private isBlocked({ url, resourceType, webContents, webContentsId }: OnBeforeRequestListenerDetails): boolean {
    const source = webContents?.getURL() ?? ''
    if (!this.engine || !/^https?:/i.test(source) || !/^https?:|^wss?:/i.test(url)) return false
    if (this.off.has(new URL(source).host)) return false
    const { match } = this.engine.match(
      Request.fromRawDetails({ url, sourceUrl: source, type: resourceType as Parameters<typeof Request.fromRawDetails>[0]['type'] })
    )
    if (match && webContentsId !== undefined) this.options.onBlocked(webContentsId)
    return match
  }

  private rememberUpgrade(target: string, original: string): void {
    if (this.upgraded.size >= MAX_REMEMBERED_UPGRADES) this.upgraded.clear()
    this.upgraded.set(target, original)
  }
}
