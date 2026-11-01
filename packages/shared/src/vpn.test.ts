import { describe, expect, it } from 'vitest'
import { byPing, isDirectProxy, parseVpnLink, proxyRule, splitVpnLinks, xrayConfig } from './vpn'

const UUID = '11111111-2222-3333-4444-555555555555'

describe('parseVpnLink', () => {
  it('reads VLESS with Reality', () => {
    const link = parseVpnLink(`vless://${UUID}@node.example:443?type=tcp&security=reality&sni=a.example&pbk=KEY&sid=ab&fp=chrome&flow=xtls-rprx-vision#Tokyo%201`)
    expect(link).toMatchObject({ protocol: 'vless', name: 'Tokyo 1', host: 'node.example', port: 443, username: UUID })
    const outbound = (xrayConfig(link!, 1080) as { outbounds: Record<string, any>[] }).outbounds[0]!
    expect(outbound.settings.vnext[0].users[0]).toMatchObject({ id: UUID, flow: 'xtls-rprx-vision', encryption: 'none' })
    expect(outbound.streamSettings).toMatchObject({ security: 'reality', realitySettings: { publicKey: 'KEY', serverName: 'a.example' } })
  })

  it('reads VMess over WebSocket', () => {
    const body = btoa(JSON.stringify({ v: '2', ps: 'Paris', add: 'v.example', port: '8443', id: UUID, net: 'ws', path: '/ws', host: 'cdn.example', tls: 'tls' }))
    const link = parseVpnLink(`vmess://${body}`)
    expect(link).toMatchObject({ protocol: 'vmess', name: 'Paris', host: 'v.example', port: 8443 })
    const outbound = (xrayConfig(link!, 1080) as { outbounds: Record<string, any>[] }).outbounds[0]!
    expect(outbound.streamSettings).toMatchObject({ network: 'ws', wsSettings: { path: '/ws', host: 'cdn.example' }, security: 'tls' })
  })

  it('reads Trojan, using TLS unless told otherwise', () => {
    const link = parseVpnLink('trojan://secret@t.example:443?sni=s.example#T')
    const outbound = (xrayConfig(link!, 1080) as { outbounds: Record<string, any>[] }).outbounds[0]!
    expect(outbound.settings.servers[0]).toMatchObject({ password: 'secret', port: 443 })
    expect(outbound.streamSettings.security).toBe('tls')
  })

  it('reads both Shadowsocks forms', () => {
    const inner = btoa('aes-256-gcm:pw')
    expect(parseVpnLink(`ss://${inner}@s.example:8388#One`)).toMatchObject({ protocol: 'ss', username: 'aes-256-gcm', password: 'pw', host: 's.example', port: 8388, name: 'One' })
    expect(parseVpnLink(`ss://${btoa('aes-256-gcm:pw@s.example:8388')}#Two`)).toMatchObject({ host: 's.example', port: 8388, name: 'Two' })
  })

  it('reads plain proxies, and knows which need the core', () => {
    const open = parseVpnLink('socks5://p.example:1080')!
    expect(isDirectProxy(open)).toBe(true)
    expect(proxyRule(open)).toBe('socks5://p.example:1080')
    expect(isDirectProxy(parseVpnLink('socks5://me:pw@p.example:1080')!)).toBe(false)
  })

  it('refuses what it cannot use', () => {
    expect(parseVpnLink('hysteria2://x@h.example:443')).toBeNull()
    expect(parseVpnLink('vless://nothing')).toBeNull()
    expect(parseVpnLink('vmess://not-base64!')).toBeNull()
    expect(parseVpnLink('hello')).toBeNull()
  })
})

describe('splitVpnLinks', () => {
  const lines = 'vless://a@b:1\ntrojan://c@d:2\n'

  it('reads plain and base64 subscriptions, skipping comments', () => {
    expect(splitVpnLinks(`# heading\n${lines}\n`)).toEqual(['vless://a@b:1', 'trojan://c@d:2'])
    expect(splitVpnLinks(btoa(lines))).toEqual(['vless://a@b:1', 'trojan://c@d:2'])
  })
})

it('sorts by ping with silent servers last', () => {
  expect(byPing([{ id: 'a' }, { id: 'b' }, { id: 'c' }], { a: null, b: 90, c: 20 }).map(({ id }) => id)).toEqual(['c', 'b', 'a'])
})
