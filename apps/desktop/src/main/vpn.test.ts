import { createServer } from 'node:net'
import type { AddressInfo } from 'node:net'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { migrate } from './storage/database'
import { KeyValueRepo } from './storage/kv'
import { pingHost, VpnService } from './vpn'

function setup(fetchText: (url: string) => Promise<string> = async () => '') {
  const db = new DatabaseSync(':memory:')
  migrate(db)
  const kv = new KeyValueRepo(db)
  const proxies: (string | null)[] = []
  const deps = {
    kv,
    vault: { encrypt: (v: string) => `sealed:${v}`, decrypt: (v: string) => v.slice('sealed:'.length) },
    corePath: () => '/nowhere/xray',
    applyProxy: async (rules: string | null) => void proxies.push(rules),
    fetchText,
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
    expect(new VpnService(deps).state().connections).toHaveLength(1)
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
    const id = vpn.addGroup('Fast')
    await vpn.add(SECRET, id)
    vpn.removeGroup(id)
    expect(vpn.state().connections[0]?.groupId).toBeNull()
  })

  it('pings only the connections asked for', async () => {
    const server = createServer().listen(0, '127.0.0.1')
    await new Promise((r) => server.once('listening', r))
    const { port } = server.address() as AddressInfo
    const { vpn } = setup()
    await vpn.add(`socks5://127.0.0.1:${port}#Up\nsocks5://127.0.0.1:1#Down`, null)
    const [up, down] = vpn.state().connections
    const results = await vpn.ping([up!.id, down!.id])
    expect(results[up!.id]).toEqual(expect.any(Number))
    expect(results[down!.id]).toBeNull()
    expect(await pingHost('127.0.0.1', 1)).toBeNull()
    server.close()
  })
})
