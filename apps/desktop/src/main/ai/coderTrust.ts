import type { KeyValueRepo } from '../storage/kv'

/**
 * What the person allowed for good, per project folder: commands ("Always allow `npm test*` here"),
 * MCP tools, and a project's own hooks and MCP servers. It's kept by the browser, never in the
 * project, so a repository can't allow its own commands. Deny rules may come from either.
 */
export interface CoderTrust {
  rules(folder: string): { allow: string[]; deny: string[] }
  setRules(folder: string, rules: { allow: string[]; deny: string[] }): void
  /** A project's hooks or MCP server, by the hash of what was allowed. */
  trusted(folder: string, what: string): string | null
  trust(folder: string, what: string, hash: string | null): void
}

const MAX_RULES = 200
const RULES_KEY = 'coder:rules'
const TRUST_KEY = 'coder:trust'

type Rules = Record<string, { allow: string[]; deny: string[] }>
type Trusted = Record<string, Record<string, string>>

const clean = (list: unknown) => (Array.isArray(list) ? [...new Set(list.filter((rule): rule is string => typeof rule === 'string' && !!rule.trim() && rule.length <= 500).map((rule) => rule.trim()))].slice(0, MAX_RULES) : [])

export class KvCoderTrust implements CoderTrust {
  constructor(private readonly kv: KeyValueRepo) {}

  rules(folder: string) {
    const saved = ((this.kv.get(RULES_KEY) as Rules | undefined) ?? {})[folder]
    return { allow: clean(saved?.allow), deny: clean(saved?.deny) }
  }

  setRules(folder: string, rules: { allow: string[]; deny: string[] }): void {
    const all = (this.kv.get(RULES_KEY) as Rules | undefined) ?? {}
    const next = { allow: clean(rules.allow), deny: clean(rules.deny) }
    if (next.allow.length === 0 && next.deny.length === 0) delete all[folder]
    else all[folder] = next
    this.kv.set(RULES_KEY, all)
  }

  trusted(folder: string, what: string): string | null {
    return ((this.kv.get(TRUST_KEY) as Trusted | undefined) ?? {})[folder]?.[what] ?? null
  }

  trust(folder: string, what: string, hash: string | null): void {
    const all = (this.kv.get(TRUST_KEY) as Trusted | undefined) ?? {}
    const forFolder = { ...all[folder] }
    if (hash === null) delete forFolder[what]
    else forFolder[what] = hash
    all[folder] = forFolder
    this.kv.set(TRUST_KEY, all)
  }
}

/** For tests and background windows: nothing outlives the process. */
export class MemoryCoderTrust implements CoderTrust {
  private readonly saved = new Map<string, { allow: string[]; deny: string[] }>()
  private readonly trustedHashes = new Map<string, string>()

  rules(folder: string) {
    return this.saved.get(folder) ?? { allow: [], deny: [] }
  }

  setRules(folder: string, rules: { allow: string[]; deny: string[] }): void {
    this.saved.set(folder, { allow: clean(rules.allow), deny: clean(rules.deny) })
  }

  trusted(folder: string, what: string): string | null {
    return this.trustedHashes.get(`${folder}\0${what}`) ?? null
  }

  trust(folder: string, what: string, hash: string | null): void {
    if (hash === null) this.trustedHashes.delete(`${folder}\0${what}`)
    else this.trustedHashes.set(`${folder}\0${what}`, hash)
  }
}
