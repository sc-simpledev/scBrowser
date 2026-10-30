import { describe, expect, it } from 'vitest'
import { httpsUpgrade, isLocalHost, matchCommands } from './privacy'

describe('isLocalHost', () => {
  it.each(['localhost', 'intranet', '127.0.0.1', '10.1.2.3', '192.168.0.1', '172.20.0.1', '[::1]', 'nas.local', 'router.lan'])(
    'treats %s as local',
    (host) => expect(isLocalHost(host)).toBe(true)
  )
  it.each(['example.com', '8.8.8.8', '172.32.0.1', '11.0.0.1', '1.2.3.example.com'])('treats %s as public', (host) =>
    expect(isLocalHost(host)).toBe(false)
  )
})

describe('httpsUpgrade', () => {
  it('upgrades public http pages and keeps the path', () => {
    expect(httpsUpgrade('http://example.com/a?b=1#c')).toBe('https://example.com/a?b=1#c')
  })
  it('leaves everything else alone', () => {
    expect(httpsUpgrade('https://example.com/')).toBeNull()
    expect(httpsUpgrade('http://localhost:3000/')).toBeNull()
    expect(httpsUpgrade('http://192.168.1.1/')).toBeNull()
    expect(httpsUpgrade('sc://settings/')).toBeNull()
    expect(httpsUpgrade('not a url')).toBeNull()
  })
})

describe('matchCommands', () => {
  it('matches words in any order and lists everything for an empty query', () => {
    expect(matchCommands('bar bookmarks').map((c) => c.id)).toEqual(['bookmarks-bar'])
    expect(matchCommands('').length).toBeGreaterThan(10)
    expect(matchCommands('zzz')).toEqual([])
  })
})
