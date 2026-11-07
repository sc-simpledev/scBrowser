import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it, vi } from 'vitest'
import { parsePasswordCsv } from '@scbrowser/shared'
import { PasswordVault } from './passwords'
import { migrate } from './storage/database'
import { KeyValueRepo } from './storage/kv'
import { HistoryRepo } from './storage/history'
import { leakHash, parseLeakRange, totpCode } from './totp'

vi.mock('electron', () => ({ webFrameMain: {} }))
const { REJECT_WORDS } = await import('./cookieBanners')

const RFC_KEY = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'

function vault() {
  const db = new DatabaseSync(':memory:')
  migrate(db)
  const kv = new KeyValueRepo(db)
  return { kv, db, vault: new PasswordVault({ kv, available: true, lockMinutes: () => 0, onChange: () => undefined }) }
}

describe('two-step codes in the vault', () => {
  it("makes RFC 6238's SHA-1 test codes", () => {
    const config = { secret: RFC_KEY, digits: 8 as const, period: 30, algorithm: 'SHA1' as const }
    expect(totpCode(config, 59_000)).toEqual({ code: '94287082', period: 30, remaining: 1 })
    const codes = [1111111109, 1111111111, 1234567890, 2000000000].map((seconds) => totpCode(config, seconds * 1000).code)
    expect(codes).toEqual(['07081804', '14050471', '89005924', '69279037'])
  })

  it('keeps a key sealed, keeps it on edits, and removes it when asked', async () => {
    const { kv, vault: v } = vault()
    await v.create('correct horse battery')
    const id = v.saveEntry({ url: 'https://example.com', username: 'sam', password: 'pw-123456789', note: '', totp: RFC_KEY })
    expect(String(kv.get('passwords:vault'))).not.toContain(RFC_KEY)
    expect(v.list()[0]).toMatchObject({ totp: true })
    expect(v.totp(id).code).toMatch(/^\d{6}$/)

    v.saveEntry({ id, url: 'https://example.com', username: 'sam', password: 'pw-changed-123', note: '' })
    expect(v.list()[0]?.totp).toBe(true)

    v.saveEntry({ id, url: 'https://example.com', username: 'sam', password: 'pw-changed-123', note: '', totp: '' })
    expect(v.list()[0]?.totp).toBeUndefined()
    expect(() => v.totp(id)).toThrow()
  })

  it('refuses a key it can’t use', async () => {
    const { vault: v } = vault()
    await v.create('correct horse battery')
    expect(() => v.saveEntry({ url: 'https://example.com', username: 'sam', password: 'pw', note: '', totp: 'nope' })).toThrow(/isn't valid/)
  })

  it('exports keys as otpauth addresses and imports them back', async () => {
    const { vault: v } = vault()
    await v.create('correct horse battery')
    v.saveEntry({ url: 'https://example.com', username: 'sam', password: 'pw-123456789', note: '', totp: RFC_KEY })
    v.saveEntry({ url: 'https://other.com', username: 'kim', password: 'pw-987654321', note: '' })
    const csv = v.exportCsv()
    expect(csv.split('\n')[0]).toBe('url,username,password,note,totp')
    expect(parsePasswordCsv(csv).find((entry) => entry.username === 'sam')?.totp).toMatch(/^otpauth:\/\/totp\//)

    const { vault: fresh } = vault()
    await fresh.create('correct horse battery')
    expect(fresh.importCsv(csv)).toBe(2)
    expect(fresh.list().filter((login) => login.totp)).toHaveLength(1)
    // The same file again changes nothing.
    expect(fresh.importCsv(csv)).toBe(0)
  })
})

describe('leak check', () => {
  it('reads the range answer, padding included', () => {
    const counts = parseLeakRange('0018A45C4D1DEF81644B54AB7F969B88D65:3\r\n00D4F6E8FA6EECAD2A3AA415EEC418D38EC:0\nbad line')
    expect(counts.get('0018A45C4D1DEF81644B54AB7F969B88D65')).toBe(3)
    expect(counts.get('00D4F6E8FA6EECAD2A3AA415EEC418D38EC')).toBe(0)
    expect(counts.size).toBe(2)
  })

  it('sends only hash prefixes, once each, and marks what turned up', async () => {
    const { vault: v } = vault()
    await v.create('correct horse battery')
    v.saveEntry({ url: 'https://a.com', username: 'a', password: 'password', note: '' })
    v.saveEntry({ url: 'https://b.com', username: 'b', password: 'password', note: '' })
    v.saveEntry({ url: 'https://c.com', username: 'c', password: 'a-long-unique-password-42', note: '' })
    const leaked = leakHash('password')
    const asked: string[] = []
    const status = await v.checkLeaks(async (prefix) => {
      asked.push(prefix)
      return prefix === leaked.slice(0, 5) ? `${leaked.slice(5)}:9545824\nFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF:0` : ''
    })
    expect(asked.every((prefix) => prefix.length === 5)).toBe(true)
    expect(new Set(asked).size).toBe(asked.length)
    expect(asked).toHaveLength(2)
    expect(status).toMatchObject({ leaked: 2 })
    expect(v.list().filter((login) => login.leaked).map((login) => login.username).sort()).toEqual(['a', 'b'])
  })

  it('stops counting a login once its password changes', async () => {
    const { vault: v } = vault()
    await v.create('correct horse battery')
    const id = v.saveEntry({ url: 'https://a.com', username: 'a', password: 'password', note: '' })
    const hash = leakHash('password')
    await v.checkLeaks(async () => `${hash.slice(5)}:10`)
    expect(v.list()[0]?.leaked).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 5))
    v.saveEntry({ id, url: 'https://a.com', username: 'a', password: 'a-new-better-password', note: '' })
    expect(v.list()[0]?.leaked).toBe(false)
  })
})

describe('forgetting a site', () => {
  it('removes its history and its subdomains’, and nothing else', () => {
    const { db } = vault()
    const history = new HistoryRepo(db)
    for (const url of ['https://example.com/a', 'https://www.example.com/b', 'https://mail.example.com/', 'https://notexample.com/', 'https://other.org/?q=example.com']) history.recordVisit(url)
    expect(history.forgetSite('example.com').sort()).toEqual(['https://example.com', 'https://mail.example.com', 'https://www.example.com'])
    expect(history.list('', 50, 0).map((entry) => entry.url).sort()).toEqual(['https://notexample.com/', 'https://other.org/?q=example.com'])
  })
})

describe('cookie banner wording', () => {
  const reject = new RegExp(REJECT_WORDS, 'i')
  it('matches reject buttons in several languages', () => {
    for (const label of ['Reject all', 'Decline', 'Reject non-essential cookies', 'Only necessary', 'Necessary cookies only', 'Use necessary cookies only', 'Continue without accepting', 'Alle ablehnen', 'Nur notwendige Cookies', 'Tout refuser', 'Rechazar todo', 'Rifiuta tutto', 'Alles weigeren', "I don't agree"]) {
      expect(reject.test(label), label).toBe(true)
    }
  })

  it('never matches accepting, or a sentence with reject in it', () => {
    for (const label of ['Accept all', 'Accept', 'Agree', 'Allow all cookies', 'OK', 'Manage options', 'You can reject all cookies in settings', 'Rejected items']) {
      expect(reject.test(label), label).toBe(false)
    }
  })
})
