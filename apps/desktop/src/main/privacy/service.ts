import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { FiltersEngine, Request } from '@ghostery/adblocker'
import { app, type OnBeforeRequestListenerDetails, type Session, type WebContents } from 'electron'
import { httpsUpgrade, type Settings } from '@scbrowser/shared'
import { isBasicPdf, isPdfResponse } from '../internal/pdf'
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

/** A first download can take a while, and pages shouldn't stall for all of it. */
const ENGINE_WAIT_MS = 5000

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
  onBlocked: (webContentsId: number, url?: string) => void
  /** Checks a page about to load in a tab. Returns why it's blocked, or null to carry on. */
  screen: (url: string, contents: WebContents) => string | null | Promise<string | null>
  /** The load was stopped, so the tab needs to show why. */
  onScreenedOut: (url: string, reason: string, contents: WebContents) => void
  isTab: (contents: WebContents) => boolean
  /** A PDF is about to open in a tab, which should show it in scTerra's viewer instead. */
  onPdf: (url: string, contents: WebContents) => void
  onChanged: () => void
}

/** Blocks ads and trackers at the network level, and moves pages onto HTTPS. */
export class PrivacyService {
  private engine: FiltersEngine | null = null
  private engineLevel: Level = 'off'
  /** Set while filters are loading. Requests wait on it, for a limited time. */
  private engineWait: Promise<void> | null = null
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
    session.webRequest.onBeforeRequest((details, respond) => {
      const { webContents: contents } = details
      if (details.resourceType !== 'mainFrame' || !contents) {
        if (!this.engineWait) return respond(this.decide(details))
        return void this.engineWait.then(() => respond(this.decide(details)))
      }
      const finish = (reason: string | null) => {
        if (!reason) return respond(this.decide(details))
        respond({ cancel: true })
        this.options.onScreenedOut(details.url, reason, contents)
      }
      if (/^file:.*\.pdf$/i.test(details.url) && this.options.isTab(contents) && !isBasicPdf(details.url)) {
        respond({ cancel: true })
        return this.options.onPdf(details.url, contents)
      }
      const verdict = this.options.screen(details.url, contents)
      if (verdict instanceof Promise) void verdict.then(finish)
      else finish(verdict)
    })
    session.webRequest.onHeadersReceived((details, respond) => {
      const { webContents: contents, resourceType, url, responseHeaders } = details
      if (resourceType === 'mainFrame' && contents && this.options.isTab(contents) && isPdfResponse(url, responseHeaders)) {
        respond({ cancel: true })
        this.options.onPdf(url, contents)
      } else respond({})
    })
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

  /** Tracking protection was turned off for this exact host. */
  isOff(host: string): boolean {
    return this.off.has(host)
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
    const load = loadEngine(level)
      .catch(() => null)
      .then((engine) => {
        if (this.engineLevel === level) this.engine = engine
      })
    // Restored tabs start loading straight away, and their trackers shouldn't slip out meanwhile.
    const waiting: Promise<void> = Promise.race([load, new Promise<void>((resolve) => setTimeout(resolve, ENGINE_WAIT_MS).unref?.())]).then(() => {
      if (this.engineWait === waiting) this.engineWait = null
    })
    this.engineWait = waiting
    await load
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

  private isBlocked({ url, resourceType, webContents, webContentsId, frame }: OnBeforeRequestListenerDetails): boolean {
    // The frame making the request, as a tab's own address can still be the page before.
    const source = frame?.url || webContents?.getURL() || ''
    if (!this.engine || !/^https?:/i.test(source) || !/^https?:|^wss?:/i.test(url)) return false
    if (this.off.has(new URL(source).host)) return false
    const { match } = this.engine.match(
      Request.fromRawDetails({ url, sourceUrl: source, type: resourceType as Parameters<typeof Request.fromRawDetails>[0]['type'] })
    )
    if (match && webContentsId !== undefined) this.options.onBlocked(webContentsId, url)
    return match
  }

  private rememberUpgrade(target: string, original: string): void {
    if (this.upgraded.size >= MAX_REMEMBERED_UPGRADES) this.upgraded.clear()
    this.upgraded.set(target, original)
  }
}
