export interface BlockRule {
  id: string
  /** A site, such as `reddit.com`. Its subdomains count too. */
  domain: string
  when: 'always' | 'schedule' | 'focus'
  /** Days the schedule runs, with Sunday as 0. */
  days: number[]
  /** `HH:MM`. A start after the end runs overnight. */
  start: string
  end: string
}

export interface BlockerConfig {
  enabled: boolean
  rules: BlockRule[]
  /** One is picked at random for each block. */
  messages: string[]
  /** Names like "Social media", which the AI matches sites against. */
  categories: string[]
  categoryMode: 'off' | 'always' | 'focus'
  /** These sites are never blocked by anything. */
  allowlist: string[]
}

export const DEFAULT_BLOCKER: BlockerConfig = { enabled: true, rules: [], messages: [], categories: [], categoryMode: 'off', allowlist: [] }

export const DEFAULT_BLOCK_MESSAGE = 'You chose to block this site.'
/** How long "continue anyway" lasts. */
export const BLOCK_PASS_MS = 15 * 60_000
/** "One more minute": a short pass that has to be waited for, longer each time that day. */
export const GRACE_PASS_MS = 60_000
export const graceWaitSeconds = (taken: number) => Math.min(60, 5 * 2 ** taken)

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/
const shortList = (value: unknown, count: number, length: number) =>
  Array.isArray(value) && value.length <= count && value.every((item) => typeof item === 'string' && item.length > 0 && item.length <= length)

const isRule = (value: unknown): boolean => {
  const rule = value as BlockRule | null
  return (
    typeof rule?.id === 'string' &&
    rule.id.length <= 64 &&
    typeof rule.domain === 'string' &&
    rule.domain.length <= 253 &&
    ['always', 'schedule', 'focus'].includes(rule.when) &&
    Array.isArray(rule.days) &&
    rule.days.every((day) => Number.isInteger(day) && day >= 0 && day <= 6) &&
    TIME.test(rule.start) &&
    TIME.test(rule.end)
  )
}

export const isBlockerConfig = (value: unknown): boolean => {
  const config = value as BlockerConfig | null
  return (
    typeof config?.enabled === 'boolean' &&
    Array.isArray(config.rules) &&
    config.rules.length <= 500 &&
    config.rules.every(isRule) &&
    shortList(config.messages, 100, 500) &&
    shortList(config.categories, 50, 80) &&
    ['off', 'always', 'focus'].includes(config.categoryMode) &&
    shortList(config.allowlist, 1000, 253)
  )
}

/** Turns what someone typed, or a pasted address, into a bare site name. */
export function toDomain(input: string): string | null {
  const text = input.trim().toLowerCase()
  if (!text) return null
  const url = /^[a-z][a-z0-9+.-]*:\/\//.test(text) ? text : `https://${text}`
  if (!URL.canParse(url)) return null
  const host = new URL(url).hostname.replace(/^www\./, '')
  return host.includes('.') || host === 'localhost' ? host : null
}

export const matchesDomain = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`)

const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3))

export function ruleActive(rule: BlockRule, focus: boolean, now: Date): boolean {
  if (rule.when === 'always') return true
  if (rule.when === 'focus') return focus
  const current = now.getHours() * 60 + now.getMinutes()
  const start = minutes(rule.start)
  const end = minutes(rule.end)
  if (start <= end) return rule.days.includes(now.getDay()) && current >= start && current < end
  // Overnight: the part after midnight belongs to the day it started on.
  if (current >= start) return rule.days.includes(now.getDay())
  return current < end && rule.days.includes((now.getDay() + 6) % 7)
}

const ruleReason = (rule: BlockRule) =>
  rule.when === 'always' ? 'This site is always blocked.' : rule.when === 'focus' ? 'This site is blocked during Focus Mode.' : `This site is blocked until ${rule.end}.`

const screenable = (url: string) => /^https?:\/\//i.test(url) && URL.canParse(url)

const allowed = (config: BlockerConfig, host: string) => config.allowlist.some((domain) => matchesDomain(host, domain))

/** Why a site's blocked by a rule, or null if no rule applies. */
export function blockReason(config: BlockerConfig, focus: boolean, url: string, now: Date): string | null {
  if (!config.enabled || !screenable(url)) return null
  const host = new URL(url).hostname
  if (allowed(config, host)) return null
  const rule = config.rules.find((candidate) => matchesDomain(host, candidate.domain) && ruleActive(candidate, focus, now))
  return rule ? ruleReason(rule) : null
}

const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[)|\.(local|localhost|test)$/

/** The host to send for a category check, or null if this visit doesn't need one. */
export function hostToClassify(config: BlockerConfig, focus: boolean, url: string): string | null {
  if (!config.enabled || config.categories.length === 0 || !screenable(url)) return null
  if (config.categoryMode === 'off' || (config.categoryMode === 'focus' && !focus)) return null
  const host = new URL(url).hostname
  return allowed(config, host) || PRIVATE_HOST.test(host) ? null : host
}

export const blockedPageUrl = (url: string, reason: string) => `sc://blocked/?${new URLSearchParams({ url, reason })}`

export const pickMessage = (messages: string[], random = Math.random()) => messages[Math.floor(random * messages.length)] ?? DEFAULT_BLOCK_MESSAGE
