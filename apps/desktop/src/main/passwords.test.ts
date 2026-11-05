import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { generatePassword, originOf, parsePasswordCsv, passwordCsv } from '@scbrowser/shared'
import { PasswordVault } from './passwords'
import { migrate } from './storage/database'
import { KeyValueRepo } from './storage/kv'

const MASTER = 'correct horse battery'

function setup() {
  const db = new DatabaseSync(':memory:')
  migrate(db)
  const kv = new KeyValueRepo(db)
  const make = () => new PasswordVault({ kv, available: true, lockMinutes: () => 0, onChange: () => undefined })
  return { kv, make, vault: make() }
}

describe('PasswordVault', () => {
  it('keeps nothing readable on disk, and only opens with the right password', async () => {
    const { kv, vault, make } = setup()
    await vault.create(MASTER)
    const id = vault.saveEntry({ url: 'https://example.com/login', username: 'sam', password: 'hunter2-secret', note: '' })
    const stored = String(kv.get('passwords:vault'))
    expect(stored).not.toContain('hunter2')
    expect(stored).not.toContain('example.com')
    expect(stored).not.toContain('sam')

    const reopened = make()
    expect(reopened.state()).toMatchObject({ exists: true, unlocked: false })
    expect(() => reopened.list()).toThrow()
    expect(await reopened.unlock('wrong password here')).toBe(false)
    expect(await reopened.unlock(MASTER)).toBe(true)
    expect(reopened.reveal(id)).toBe('hunter2-secret')
    expect(JSON.stringify(reopened.list())).not.toContain('hunter2')
    reopened.lock()
    expect(() => reopened.reveal(id)).toThrow()
  }, 30_000)

  it('matches the exact site only', async () => {
    const { vault } = setup()
    await vault.create(MASTER)
    vault.saveEntry({ url: 'https://example.com', username: 'sam', password: 'p', note: '' })
    expect(vault.matches('https://example.com')).toHaveLength(1)
    for (const other of ['http://example.com', 'https://a.example.com', 'https://example.com.evil.test', 'https://example.com:8443']) {
      expect(vault.matches(other)).toHaveLength(0)
    }
  }, 30_000)

  it('offers saving only when something is new or changed, and respects never', async () => {
    const { vault } = setup()
    await vault.create(MASTER)
    const site = 'https://example.com'
    expect(vault.offerFor(site, 'sam', 'one')).toBe('new')
    vault.saveEntry({ url: site, username: 'sam', password: 'one', note: '' })
    expect(vault.offerFor(site, 'sam', 'one')).toBeNull()
    expect(vault.offerFor(site, 'sam', 'two')).toBe('update')
    vault.neverFor(site)
    expect(vault.offerFor(site, 'other', 'x')).toBeNull()
  }, 30_000)

  it('changes the master password, and can be reset when it is forgotten', async () => {
    const { vault, make } = setup()
    await vault.create(MASTER)
    const id = vault.saveEntry({ url: 'https://example.com', username: 'sam', password: 'keep', note: '' })
    expect(await vault.changeMaster('not the password', 'another long password')).toBe(false)
    expect(await vault.changeMaster(MASTER, 'another long password')).toBe(true)
    const reopened = make()
    expect(await reopened.unlock('another long password')).toBe(true)
    expect(reopened.reveal(id)).toBe('keep')
    reopened.reset()
    expect(reopened.state()).toMatchObject({ exists: false, unlocked: false })
  }, 60_000)

  it('refuses a short master password', async () => {
    await expect(setup().vault.create('short')).rejects.toThrow('at least')
  })
})

describe('password helpers', () => {
  it('finds the origin, and refuses anything that is not a website', () => {
    expect(originOf('https://example.com/a?b=1')).toBe('https://example.com')
    expect(originOf('example.com')).toBe('https://example.com')
    expect(originOf('http://localhost:3000/x')).toBe('http://localhost:3000')
    expect(originOf('javascript:alert(1)')).toBeNull()
    expect(originOf('file:///etc/passwd')).toBeNull()
  })

  it('reads browser exports, with awkward cells, and writes them back', () => {
    const chrome = 'name,url,username,password,note\r\nEx,https://example.com/,"a,b","p""q",hi\r\nBad,not a url at all,x,y,\r\nNone,https://n.example,x,,\r\n'
    expect(parsePasswordCsv(chrome)).toEqual([{ url: 'https://example.com/', username: 'a,b', password: 'p"q', note: 'hi' }])
    const firefox = '"url","username","password","httpRealm"\n"https://f.example","u","p",""\n'
    expect(parsePasswordCsv(firefox)).toEqual([{ url: 'https://f.example', username: 'u', password: 'p', note: '' }])
    expect(parsePasswordCsv(passwordCsv([{ url: 'https://example.com', username: 'a,b', password: 'p"q\nr', note: '' }]))[0]?.password).toBe('p"q\nr')
    expect(parsePasswordCsv('nothing,useful\n1,2\n')).toEqual([])
  })

  it('generates the requested length, differently each time', () => {
    const random = (values: Uint32Array) => void crypto.getRandomValues(values)
    expect(generatePassword(random)).toHaveLength(20)
    expect(generatePassword(random)).not.toBe(generatePassword(random))
  })
})

describe('addresses and details', () => {
  const home = { label: 'Home', fullName: 'Sam Lee', email: 'sam@example.com', phone: '', organization: '', address1: '1 Secret Street', address2: '', city: '', region: '', postalCode: '', country: '' }

  it('stay sealed, come back after unlocking, and can be removed', async () => {
    const { kv, vault, make } = setup()
    await vault.create(MASTER)
    const id = vault.saveIdentity(home)
    expect(String(kv.get('passwords:vault'))).not.toContain('Secret Street')
    vault.lock()
    expect(() => vault.identities()).toThrow()
    const again = make()
    await again.unlock(MASTER)
    expect(again.identity(id).address1).toBe('1 Secret Street')
    again.removeIdentity(id)
    expect(again.identities()).toEqual([])
  })

  it('replaces one when saved again, and refuses an empty one', async () => {
    const { vault } = setup()
    await vault.create(MASTER)
    const id = vault.saveIdentity(home)
    vault.saveIdentity({ ...home, id, city: 'Perth' })
    expect(vault.identities()).toHaveLength(1)
    expect(vault.identity(id).city).toBe('Perth')
    expect(() => vault.saveIdentity({ ...home, label: ' ', fullName: '', email: '', address1: '' })).toThrow()
  })

  it('opens a vault made before details existed', async () => {
    const { vault } = setup()
    await vault.create(MASTER)
    expect(vault.identities()).toEqual([])
  })
})
