import { createServer as createHttp } from 'node:http'
import { createServer } from 'node:net'
import type { AddressInfo } from 'node:net'
import { DatabaseSync } from 'node:sqlite'
import { readTunToggle } from '@scbrowser/shared'
import { describe, expect, it, vi } from 'vitest'
import { migrate } from './storage/database'
import { KeyValueRepo } from './storage/kv'
import { bypassRules, parseBypassList, type VpnMethod, type VpnScope } from '@scbrowser/shared'
import { detectBackends, makeSystemProxy, type SystemProxy } from './systemProxy'
import { pingHost, VpnService } from './vpn'

function setup(fetchText: (url: string) => Promise<string> = async () => '', route: { scope: VpnScope; method: VpnMethod } = { scope: 'browser', method: 'proxy' }) {
  const db = new DatabaseSync(':memory:')
  migrate(db)
  const kv = new KeyValueRepo(db)
  const proxies: (string | null)[] = []
  const deps = {
    kv,
    vault: { encrypt: async (v: string) => `sealed:${v}`, decrypt: async (v: string) => v.slice('sealed:'.length) },
    corePath: () => '/nowhere/xray',
    route: () => route,
    autoFastest: () => false,
    systemProxy: null as SystemProxy | null,
    tun: null,
    applyProxy: async (rules: string | null) => void proxies.push(rules),
    fetchText,
    probeTarget: { host: 'probe.example', port: 80 },
    onChange: () => undefined
  }
  return { vpn: new VpnService(deps), deps, kv, proxies }
}

const SECRET = 'trojan://hunter2@t.example:443#Node'

describe('VpnService', () => {
  it('keeps links out of what the interface sees, and encrypted on disk', async () => {
    const { vpn, kv, deps } = setup()
    await vpn.add(SECRET, null)
    expect(JSON.stringify(vpn.state())).not.toContain('hunter2')
    expect(String(kv.get('vpn:store'))).toMatch(/^sealed:/)
    const reopened = new VpnService(deps)
    await reopened.ready
    expect(reopened.state().connections).toHaveLength(1)
  })

  it('counts duplicates once and reports unusable links', async () => {
    const { vpn } = setup()
    expect(await vpn.add(`${SECRET}\n${SECRET}\nhysteria2://x@y:1`, null)).toEqual({ added: 1, skipped: 1 })
  })

  it('turns a plain proxy on and off without the core', async () => {
    const { vpn, proxies } = setup()
    await vpn.add('socks5://p.example:1080', null)
    await vpn.setEnabled(true)
    expect(vpn.summary()).toMatchObject({ available: true, enabled: true })
    await vpn.setEnabled(false)
    expect(proxies).toEqual(['socks5://p.example:1080', null])
  })

  it('says so when the core is missing, and stays off', async () => {
    const { vpn, proxies } = setup()
    await vpn.add(SECRET, null)
    await vpn.setEnabled(true)
    expect(vpn.summary()).toMatchObject({ enabled: false })
    expect(vpn.summary().error).toContain('core')
    expect(proxies.at(-1)).toBeNull()
  })

  it('keeps the chosen connection when a subscription refreshes while off', async () => {
    const list = 'trojan://a@one.example:443#One\ntrojan://b@two.example:443#Two'
    const { vpn } = setup(async () => list)
    await vpn.subscribe('https://list.example/sub', 'List')
    const second = vpn.state().connections.find(({ name }) => name === 'Two')!
    await vpn.select(second.id)
    await vpn.refresh(vpn.state().groups[0]!.id)
    const { activeId, connections } = vpn.state()
    expect(connections.find(({ id }) => id === activeId)?.name).toBe('Two')
  })

  it('makes a group from a subscription and refreshes it', async () => {
    let list = 'trojan://a@one.example:443#One\ntrojan://b@two.example:443#Two'
    const { vpn } = setup(async () => btoa(list))
    expect(await vpn.subscribe('https://sub.example/list', 'Nodes')).toEqual({ added: 2, skipped: 0 })
    const [group] = vpn.state().groups
    expect(group).toMatchObject({ name: 'Nodes', subscription: true })
    list = 'trojan://c@three.example:443#Three'
    await vpn.refresh(group!.id)
    expect(vpn.state().connections.map((c) => c.name)).toEqual(['Three'])
  })

  it('treats a pasted web address with a path as a subscription', async () => {
    const { vpn } = setup(async () => SECRET)
    expect(await vpn.add('https://raw.example/nodes.txt', null)).toEqual({ added: 1, skipped: 0 })
    expect(vpn.state().groups).toHaveLength(1)
  })

  it('keeps a hand-made group’s connections when the group goes', async () => {
    const { vpn } = setup()
    const id = await vpn.addGroup('Fast')
    await vpn.add(SECRET, id)
    await vpn.removeGroup(id)
    expect(vpn.state().connections[0]?.groupId).toBeNull()
  })

  it('pings only the connections asked for', async () => {
    const server = createServer().listen(0, '127.0.0.1')
    await new Promise((r) => server.once('listening', r))
    const { port } = server.address() as AddressInfo
    const { vpn } = setup()
    await vpn.add(`socks5://127.0.0.1:${port}#Up\nsocks5://127.0.0.1:1#Down`, null)
    const [up, down] = vpn.state().connections
    // This fake takes the connection but never talks, like many dead public servers.
    const results = await vpn.ping([up!.id, down!.id], 300)
    expect(results[up!.id]).toBeNull()
    expect(results[down!.id]).toBeNull()
    expect(vpn.pingProgress()).toEqual({ running: false, done: 2, total: 2 })
    expect(await pingHost('127.0.0.1', 1)).toBeNull()
    server.close()
  })

  it('passes a proxy only when the test page really comes back', async () => {
    const proxy = (reply: string) =>
      new Promise<ReturnType<typeof createHttp>>((resolve) => {
        const server = createHttp((_req, res) => res.writeHead(reply === 'ok' ? 204 : 200).end(reply === 'ok' ? undefined : 'Blocked'))
        server.listen(0, '127.0.0.1', () => resolve(server))
      })
    const good = await proxy('ok')
    const bad = await proxy('blocked')
    const { vpn } = setup()
    const portOf = (server: ReturnType<typeof createHttp>) => (server.address() as AddressInfo).port
    await vpn.add(`http://127.0.0.1:${portOf(good)}#Good\nhttp://127.0.0.1:${portOf(bad)}#Bad`, null)
    const [first, second] = vpn.state().connections
    const results = await vpn.ping([first!.id, second!.id], 1000)
    expect(results[first!.id]).toEqual(expect.any(Number))
    expect(results[second!.id]).toBeNull()
    good.close()
    bad.close()
  })
})

describe('VpnService saving', () => {
  it('keeps the change and says so when the system cannot encrypt', async () => {
    const { deps } = setup()
    const vpn = new VpnService({ ...deps, vault: { encrypt: async () => Promise.reject(new Error('no keychain')), decrypt: async (v: string) => v } })
    expect(await vpn.add(SECRET, null)).toEqual({ added: 1, skipped: 0 })
    expect(vpn.state().connections).toHaveLength(1)
    expect(vpn.state().error).toContain("couldn't be saved")
  })
})

describe('whole-computer VPN', () => {
  it('stays on the browser by default and refuses a method this computer lacks', async () => {
    const { vpn, proxies } = setup(undefined, { scope: 'computer', method: 'tun' })
    await vpn.add('http://proxy.example:8080#Plain', null)
    await vpn.setEnabled(true)
    expect(vpn.summary().enabled).toBe(false)
    expect(vpn.summary().error).toContain('TUN')
    expect(proxies.at(-1)).toBeNull()
    expect(setup().vpn.state().scope).toBe('browser')
    expect(setup().vpn.state().method).toBe('proxy')
  })

  it('puts a system proxy back after a crash, unless the person has since changed it', () => {
    const fake = (current: string) => {
      const restored: string[] = []
      const systemProxy: SystemProxy = { read: () => current, apply: () => undefined, restore: (saved) => void restored.push(saved), watchForCrash: () => ({ stop: () => undefined }) }
      return { systemProxy, restored }
    }
    const { deps, kv } = setup()
    kv.set('vpn:system-proxy', JSON.stringify({ before: 'theirs', applied: 'ours' }))
    const crashed = fake('ours')
    new VpnService({ ...deps, systemProxy: crashed.systemProxy })
    expect(crashed.restored).toEqual(['theirs'])
    expect(kv.get('vpn:system-proxy')).toBeUndefined()

    kv.set('vpn:system-proxy', JSON.stringify({ before: 'theirs', applied: 'ours' }))
    const changed = fake('something new')
    new VpnService({ ...deps, systemProxy: changed.systemProxy })
    expect(changed.restored).toEqual([])
  })
})

describe('system proxy commands', () => {
  const recorder = (answers: Record<string, string> = {}) => {
    const commands: string[][] = []
    const run = (command: string[]) => {
      commands.push(command)
      const answer = Object.entries(answers).find(([match]) => command.join(' ').includes(match))
      if (answers.fail && command.join(' ').includes(answers.fail)) throw new Error('missing')
      return answer?.[1] ?? ''
    }
    return { commands, run: run as never }
  }
  const PORTS = { host: '127.0.0.1', httpPort: 1111, socksPort: 2222 }

  it('sets and restores KDE and the GTK setting KDE apps also use', () => {
    const { commands, run } = recorder({ 'kreadconfig6 --file kioslaverc --group Proxy Settings --key ProxyType': '0', 'proxy mode': "'none'" })
    const proxy = makeSystemProxy(detectBackends('linux', 'KDE', run), run)!
    const before = proxy.read()
    commands.length = 0
    proxy.apply(PORTS)
    const written = commands.map((c) => c.join(' '))
    expect(written).toContain('kwriteconfig6 --file kioslaverc --group Proxy Settings --key httpProxy http://127.0.0.1 1111')
    expect(written).toContain('kwriteconfig6 --file kioslaverc --group Proxy Settings --key socksProxy socks://127.0.0.1 2222')
    expect(written).toContain('gsettings set org.gnome.system.proxy mode manual')
    expect(written.some((c) => c.startsWith('dbus-send'))).toBe(true)
    commands.length = 0
    proxy.restore(before)
    const undone = commands.map((c) => c.join(' '))
    expect(undone).toContain('kwriteconfig6 --file kioslaverc --group Proxy Settings --key ProxyType 0')
    expect(undone).toContain('kwriteconfig6 --file kioslaverc --group Proxy Settings --key httpProxy --delete')
    expect(undone).toContain("gsettings set org.gnome.system.proxy mode 'none'")
  })

  it('finds nothing to set on a desktop without either', () => {
    const { run } = recorder({ fail: 'gsettings' })
    expect(makeSystemProxy(detectBackends('linux', 'XFCE', run), run)).toBeNull()
  })

  it('writes the Windows registry and tells running apps', () => {
    const { commands, run } = recorder({ ProxyEnable: '    ProxyEnable    REG_DWORD    0x0', ProxyServer: '    ProxyServer    REG_SZ    old:1' })
    const proxy = makeSystemProxy(detectBackends('win32', '', run), run)!
    const before = proxy.read()
    commands.length = 0
    proxy.apply(PORTS)
    expect(commands.some((c) => c.join(' ').includes('http=127.0.0.1:1111;https=127.0.0.1:1111;socks=127.0.0.1:2222'))).toBe(true)
    expect(commands.at(-1)?.[0]).toBe('powershell')
    commands.length = 0
    proxy.restore(before)
    expect(commands[0]?.join(' ')).toContain('ProxyServer /t REG_SZ /d old:1')
    expect(commands[1]?.join(' ')).toContain('ProxyEnable /t REG_DWORD /d 0')
  })

  /** Behaves like networksetup: a setter stores the address, and the state command turns it on. */
  function fakeMac({ refuse = () => undefined, quietlyIgnored = false }: { refuse?: (command: string[]) => string | undefined; quietlyIgnored?: boolean } = {}) {
    const state: Record<string, { on: boolean; server: string; port: string }> = {}
    const entry = (flag: string, service: string) => (state[`${service}/${flag.replace(/^-(get|set)/, '').replace(/state$/, '')}`] ??= { on: false, server: '', port: '0' })
    const run = (command: string[]) => {
      const refused = refuse(command)
      if (refused) throw new Error(`Command failed: ${command.join(' ')}\n${refused}`)
      const [, flag, service, ...rest] = command as [string, string, string, ...string[]]
      if (flag === '-listallnetworkservices') return 'An asterisk (*) denotes that a network service is disabled.\nWi-Fi\n*Old Ethernet\nOther VPN\n'
      if (flag.startsWith('-get')) {
        const { on, server, port } = entry(flag, service)
        return `Enabled: ${on ? 'Yes' : 'No'}\nServer: ${server}\nPort: ${port}\nAuthenticated Proxy Enabled: 0\n`
      }
      if (quietlyIgnored) return '** Error: Command requires admin privileges.\n'
      if (flag.endsWith('state')) entry(flag, service).on = rest[0] === 'on'
      else Object.assign(entry(flag, service), { server: rest[0], port: rest[1] })
      return ''
    }
    return { state, run: run as never }
  }

  it('turns on all three Mac proxies, and puts back what was there', () => {
    const { state, run } = fakeMac()
    state['Wi-Fi/socksfirewallproxy'] = { on: false, server: 'old.example', port: '9' }
    const proxy = makeSystemProxy(detectBackends('darwin', '', run), run)!
    const before = proxy.read()
    proxy.apply(PORTS)
    expect(state['Wi-Fi/webproxy']).toEqual({ on: true, server: '127.0.0.1', port: '1111' })
    expect(state['Wi-Fi/securewebproxy']).toEqual({ on: true, server: '127.0.0.1', port: '1111' })
    expect(state['Wi-Fi/socksfirewallproxy']).toEqual({ on: true, server: '127.0.0.1', port: '2222' })
    expect(Object.keys(state).some((key) => key.startsWith('Old Ethernet'))).toBe(false)
    proxy.restore(before)
    expect(state['Wi-Fi/webproxy']?.on).toBe(false)
    expect(state['Wi-Fi/socksfirewallproxy']).toEqual({ on: false, server: 'old.example', port: '9' })
  })

  it('carries on past a Mac network service that refuses', () => {
    const { state, run } = fakeMac({ refuse: (command) => (command[2] === 'Other VPN' ? '** Error: The parameters were not valid.' : undefined) })
    const proxy = makeSystemProxy(detectBackends('darwin', '', run), run)!
    const before = proxy.read()
    expect(JSON.parse(before)[0]).not.toHaveProperty('Other VPN')
    proxy.apply(PORTS)
    expect(state['Wi-Fi/webproxy']?.on).toBe(true)
  })

  it('says so when a Mac refuses the change, in its own words', () => {
    const { run } = fakeMac({ refuse: (command) => (command[1]?.startsWith('-set') ? 'Command requires admin privileges.' : undefined) })
    const proxy = makeSystemProxy(detectBackends('darwin', '', run), run)!
    expect(() => proxy.apply(PORTS)).toThrow(/couldn't be turned on.*Command requires admin privileges/)
  })

  it('notices a Mac ignoring the change while reporting success', () => {
    const { run } = fakeMac({ quietlyIgnored: true })
    const proxy = makeSystemProxy(detectBackends('darwin', '', run), run)!
    expect(() => proxy.apply(PORTS)).toThrow(/couldn't be turned on.*admin privileges/)
  })
})

describe('VPN conveniences', () => {
  it('stays closed when connecting at start fails, until it is turned off', async () => {
    const { vpn, proxies } = setup()
    await vpn.add('trojan://x@t.example:443?security=tls#Node', null)
    await vpn.holdPages()
    await vpn.connectAtStart()
    expect(vpn.summary().enabled).toBe(true)
    expect(vpn.summary().error).toContain('won’t load')
    expect(proxies.at(-1)).toContain('127.0.0.1')
    await vpn.setEnabled(false)
    expect(vpn.summary().enabled).toBe(false)
    expect(proxies.at(-1)).toBeNull()
  })

  it('lets pages through at start if there is nothing to connect to', async () => {
    const { vpn, proxies } = setup()
    await vpn.holdPages()
    await vpn.connectAtStart()
    expect(proxies.at(-1)).toBeNull()
    expect(vpn.summary().enabled).toBe(false)
  })
})

describe('VPN bypass list', () => {
  it('tidies what was typed, and covers subdomains', () => {
    expect(parseBypassList('https://Example.com/path\nbank.example.org, *.corp.test\nnot a si!te\nexample.com')).toEqual(['example.com', 'bank.example.org', '*.corp.test', 'not', 'a'])
    expect(bypassRules(['example.com', '*.corp.test'])).toBe('example.com;*.example.com;*.corp.test')
  })
})

describe('TUN toggle', () => {
  const tun = { resolve: async () => '1.1.1.1', start: async () => ({ stop: async () => undefined }) }
  const ready = (toggle: () => boolean | null, route: { scope: VpnScope; method: VpnMethod }) => {
    const reconnects: boolean[] = []
    const vpn = new VpnService({ ...setup(undefined, route).deps, tun, readToggle: async () => toggle(), setMethod: (method) => void (route.method = method) })
    Object.assign(vpn, { enabled: true })
    Object.assign(vpn, { applyEnabled: async (on: boolean) => void reconnects.push(on) })
    return { vpn, reconnects }
  }

  it('moves a connected TUN user to the system proxy when off, and offers TUN again when on', async () => {
    let allowed = false
    const route: { scope: VpnScope; method: VpnMethod } = { scope: 'computer', method: 'tun' }
    const { vpn, reconnects } = ready(() => allowed, route)
    await vpn.checkTunToggle()
    expect(route.method).toBe('proxy')
    expect(reconnects).toEqual([true])
    expect(vpn.state().unavailable.tun).toBe('TUN is off for now.')
    expect(vpn.state().error).toContain('moved to the system proxy')
    allowed = true
    await vpn.checkTunToggle()
    expect(vpn.state().unavailable.tun).toBeNull()
    expect(route.method).toBe('proxy')
  })

  it('leaves anyone not using TUN alone', async () => {
    const route: { scope: VpnScope; method: VpnMethod } = { scope: 'browser', method: 'proxy' }
    const { reconnects, vpn } = ready(() => false, route)
    await vpn.checkTunToggle()
    expect(reconnects).toEqual([])
  })

  it('changes nothing when the file can\'t be read', async () => {
    const route: { scope: VpnScope; method: VpnMethod } = { scope: 'computer', method: 'tun' }
    const { vpn } = ready(() => null, route)
    await vpn.checkTunToggle()
    expect(route.method).toBe('tun')
    expect(vpn.state().unavailable.tun).toBeNull()
  })

  it('checks once when turning on, and moves off TUN first if it says off', async () => {
    const route: { scope: VpnScope; method: VpnMethod } = { scope: 'computer', method: 'tun' }
    const { vpn } = ready(() => false, route)
    const used: VpnMethod[] = []
    Object.assign(vpn, { enabled: false, applyEnabled: async () => void used.push(route.method) })
    await vpn.setEnabled(true)
    expect(used).toEqual(['proxy'])
    expect(vpn.state().error).toContain('moved to the system proxy')
  })

  it('just connects if the check fails', async () => {
    const route: { scope: VpnScope; method: VpnMethod } = { scope: 'computer', method: 'tun' }
    const made = setup(undefined, route)
    const vpn = new VpnService({ ...made.deps, tun, readToggle: async () => Promise.reject(new Error('offline')) })
    const used: VpnMethod[] = []
    Object.assign(vpn, { applyEnabled: async () => void used.push(route.method) })
    await vpn.setEnabled(true)
    expect(used).toEqual(['tun'])
    expect(vpn.state().error).toBeNull()
  })

  it('checks every two minutes only while the VPN is on', async () => {
    vi.useFakeTimers()
    try {
      let reads = 0
      const vpn = new VpnService({ ...setup().deps, readToggle: async () => (reads++, true) })
      await vpn.add('socks5://127.0.0.1:1080#one', null)
      await vpn.select(vpn.state().connections[0]!.id)
      await vi.advanceTimersByTimeAsync(600_000)
      expect(reads).toBe(0)
      await vpn.setEnabled(true)
      expect(vpn.state().enabled).toBe(true)
      expect(reads).toBe(1)
      await vi.advanceTimersByTimeAsync(120_000)
      expect(reads).toBe(2)
      await vpn.setEnabled(false)
      await vi.advanceTimersByTimeAsync(600_000)
      expect(reads).toBe(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('reads only a first line of on or off', () => {
    for (const text of ['on', ' ON\n', '\n`on`\nnotes']) expect(readTunToggle(text)).toBe(true)
    for (const text of ['off', 'OFF\n']) expect(readTunToggle(text)).toBe(false)
    for (const text of ['', 'true', 'maybe off']) expect(readTunToggle(text)).toBeNull()
  })
})
