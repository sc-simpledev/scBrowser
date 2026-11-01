import { blockedPageUrl, blockReason, BLOCK_PASS_MS, hostToClassify, pickMessage } from '@scbrowser/shared'
import { parseSiteCategory, siteCategoryPrompt } from '@scbrowser/ai'
import type { SettingsStore } from './settings'
import type { KeyValueRepo } from './storage/kv'

const CACHE_KEY = 'blocker:hosts'
const MAX_CACHED_HOSTS = 5000
const CLASSIFY_TIMEOUT_MS = 6000

interface CategoryCache {
  /** The categories these answers were for. Changing them starts over. */
  categories: string
  hosts: Record<string, string | null>
}

interface Classifier {
  ready: () => boolean
  disabled: (host: string) => boolean
  complete: (system: string, user: string) => Promise<string>
}

/** Decides whether a page may load. Rules are instant; a new site in a category costs one AI request. */
export class SiteBlocker {
  private cache: CategoryCache
  private readonly pending = new Map<string, Promise<string | null>>()
  private readonly passes = new Map<string, number>()

  constructor(
    private readonly settings: SettingsStore,
    private readonly kv: KeyValueRepo,
    private readonly classifier: Classifier
  ) {
    this.cache = (kv.get(CACHE_KEY) as CategoryCache | undefined) ?? { categories: '', hosts: {} }
  }

  /** Why this address is blocked, or null. A promise means the AI is being asked. */
  screen(url: string, now = new Date()): string | null | Promise<string | null> {
    const { blocker, focusMode } = this.settings.get()
    if (!/^https?:/i.test(url) || !URL.canParse(url)) return null
    if ((this.passes.get(new URL(url).hostname) ?? 0) > now.getTime()) return null
    const reason = blockReason(blocker, focusMode, url, now)
    if (reason) return reason
    const host = hostToClassify(blocker, focusMode, url)
    if (!host || !this.classifier.ready() || this.classifier.disabled(host)) return null
    const signature = blocker.categories.join('\n')
    if (this.cache.categories !== signature) this.cache = { categories: signature, hosts: {} }
    if (Object.hasOwn(this.cache.hosts, host)) return this.describe(this.cache.hosts[host] ?? null)
    return this.classify(host, blocker.categories, signature).then((category) => this.describe(category))
  }

  private describe(category: string | null): string | null {
    return category && `This site looks like ${category}, one of your blocked categories.`
  }

  /** Only the site's name is sent, never the page or its full address. */
  private classify(host: string, categories: string[], signature: string): Promise<string | null> {
    const running = this.pending.get(host)
    if (running) return running
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), CLASSIFY_TIMEOUT_MS))
    const request = this.classifier
      .complete(siteCategoryPrompt(categories), host)
      .then((reply) => {
        const category = parseSiteCategory(reply, categories)
        if (this.cache.categories === signature) this.remember(host, category)
        return category
      })
      // If the AI can't answer, browsing carries on and the site is checked next time.
      .catch(() => null)
    const answer = Promise.race([request, timeout]).finally(() => this.pending.delete(host))
    this.pending.set(host, answer)
    return answer
  }

  private remember(host: string, category: string | null): void {
    const hosts = Object.keys(this.cache.hosts)
    if (hosts.length >= MAX_CACHED_HOSTS) delete this.cache.hosts[hosts[0]!]
    this.cache.hosts[host] = category
    this.kv.set(CACHE_KEY, this.cache)
  }

  /** The person chose to continue, so leave this site alone for a while. */
  pass(url: string, now = Date.now()): void {
    this.passes.set(new URL(url).hostname, now + BLOCK_PASS_MS)
  }

  message(): string {
    return pickMessage(this.settings.get().blocker.messages)
  }

  pageFor(url: string, reason: string): string {
    return blockedPageUrl(url, reason)
  }
}
