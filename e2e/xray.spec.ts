import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createServer } from 'node:net'
import type { AddressInfo } from 'node:net'
import { resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import { activeTab, go, launch, serveSite, setSetting, titled, type Harness, type Site } from './app'

const CORE = resolve(__dirname, `../apps/desktop/resources/xray/${process.platform === 'win32' ? 'xray.exe' : 'xray'}`)
const UUID = '11111111-2222-3333-4444-555555555555'
const PASSWORD = 'test-password'

const freePort = () =>
  new Promise<number>((done) => {
    const server = createServer().listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      server.close(() => done(port))
    })
  })

const ports = { vless: 0, vmess: 0, trojan: 0, ss: 0 }
let server: ChildProcess
let h: Harness
let site: Site

test.skip(!existsSync(CORE), 'Run apps/desktop/scripts/fetch-xray.mjs first')

test.beforeAll(async () => {
  for (const key of Object.keys(ports) as (keyof typeof ports)[]) ports[key] = await freePort()
  const listen = '127.0.0.1'
  server = spawn(CORE, ['run', '-c', 'stdin:'], { stdio: ['pipe', 'ignore', 'inherit'] })
  server.stdin!.end(
    JSON.stringify({
      log: { loglevel: 'warning' },
      inbounds: [
        { listen, port: ports.vless, protocol: 'vless', settings: { clients: [{ id: UUID }], decryption: 'none' } },
        { listen, port: ports.vmess, protocol: 'vmess', settings: { clients: [{ id: UUID }] } },
        { listen, port: ports.trojan, protocol: 'trojan', settings: { clients: [{ password: PASSWORD }] } },
        { listen, port: ports.ss, protocol: 'shadowsocks', settings: { method: 'aes-256-gcm', password: PASSWORD, network: 'tcp' } }
      ],
      // Xray refuses private addresses by default, and the test site is on this computer.
      outbounds: [{ protocol: 'freedom', settings: { finalRules: [{ action: 'allow' }] } }]
    })
  )
  await new Promise((r) => setTimeout(r, 800))
})

test.afterAll(() => {
  server?.kill()
})

test.beforeEach(async () => {
  site = await serveSite({ '/alpha': titled('Alpha page') })
  h = await launch()
  await setSetting(h, { httpsOnly: false })
})

test.afterEach(async () => {
  await h.close().catch(() => undefined)
  site.server.close()
})

const links: Record<keyof typeof ports, () => string> = {
  vless: () => `vless://${UUID}@127.0.0.1:${ports.vless}?type=tcp&security=none#Node`,
  vmess: () => `vmess://${btoa(JSON.stringify({ ps: 'Node', add: '127.0.0.1', port: ports.vmess, id: UUID, net: 'tcp' }))}`,
  trojan: () => `trojan://${PASSWORD}@127.0.0.1:${ports.trojan}?security=none#Node`,
  ss: () => `ss://${btoa(`aes-256-gcm:${PASSWORD}`)}@127.0.0.1:${ports.ss}#Node`
}

for (const name of Object.keys(links) as (keyof typeof ports)[]) {
  test(`loads a page through a real ${name} connection`, async () => {
    await go(h, 'sc://vpn')
    const page = await h.page('sc://vpn')
    await page.getByRole('textbox', { name: 'Connection links' }).fill(links[name]())
    await page.getByRole('button', { name: 'Add links' }).click()
    await expect(page.getByRole('status')).toContainText('Added 1')
    await page.getByRole('switch', { name: 'VPN' }).click()
    await expect(h.chrome.getByRole('button', { name: 'VPN: on, Node' })).toBeVisible({ timeout: 10000 })

    await h.chrome.evaluate(() => window.scb.invoke('tabs:create'))
    await go(h, site.url('/alpha'))
    await expect(activeTab(h)).toContainText('Alpha page')
    const route = await h.app.evaluate(({ session }, url) => session.defaultSession.resolveProxy(url), site.url('/alpha'))
    expect(route).toMatch(/^SOCKS5 127\.0\.0\.1:/)
  })
}

test('stops and says so when the core exits, and pages fail rather than go direct', async () => {
  await go(h, 'sc://vpn')
  const page = await h.page('sc://vpn')
  await page.getByRole('textbox', { name: 'Connection links' }).fill(links.ss())
  await page.getByRole('button', { name: 'Add links' }).click()
  await page.getByRole('switch', { name: 'VPN' }).click()
  await expect(h.chrome.getByRole('button', { name: 'VPN: on, Node' })).toBeVisible({ timeout: 10000 })
  await h.app.evaluate(() => {
    const { scbVpn } = globalThis as unknown as { scbVpn: { core: { kill(): void } } }
    scbVpn.core.kill()
  })
  await expect(h.chrome.getByRole('button', { name: 'VPN: problem' })).toBeVisible()
  await h.chrome.evaluate(() => window.scb.invoke('tabs:create'))
  await go(h, site.url('/alpha'))
  await expect(activeTab(h)).not.toContainText('Alpha page')
})

test('ping passes a working connection and fails one that accepts but carries nothing', async () => {
  const probe = new URL(site.url('/generate_204'))
  const silent = createServer().listen(0, '127.0.0.1')
  await new Promise((r) => silent.once('listening', r))
  await h.close()
  h = await launch(undefined, [], { SCB_VPN_PROBE: `${probe.hostname}:${probe.port}` })
  await go(h, 'sc://vpn')
  const page = await h.page('sc://vpn')
  const dead = `ss://${btoa(`aes-256-gcm:${PASSWORD}`)}@127.0.0.1:${(silent.address() as AddressInfo).port}#Dead`
  await page.getByRole('textbox', { name: 'Connection links' }).fill(`${links.ss().replace('#Node', '#Alive')}\n${dead}\nvless://${UUID}@198.51.100.1:443?security=none#Refused`)
  await page.getByRole('button', { name: 'Add links' }).click()
  await page.getByRole('spinbutton', { name: 'Ping time limit' }).fill('2500')
  await page.getByRole('button', { name: 'Ping', exact: true }).click()
  const row = (name: string) => page.locator('li', { hasText: name })
  await expect(row('Alive')).toContainText(/\d+ ms/, { timeout: 15000 })
  await expect(row('Dead')).toContainText('Not working', { timeout: 15000 })
  await expect(row('Refused')).toContainText('Not working')
  silent.close()
})
