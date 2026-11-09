import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { expect, test } from '@playwright/test'
import { go, launch, setSetting, type Harness } from './app'

let h: Harness
let server: Server

test.afterEach(async () => {
  await h.close().catch(() => undefined)
  server.closeAllConnections()
  server.close()
})

test('TOGGLE.md set to off moves someone from TUN to the system proxy, and on offers TUN again', async () => {
  let toggle = 'on'
  server = createServer((_req, res) => res.end(toggle))
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/TOGGLE.md`
  h = await launch(undefined, [], { SCB_VPN_TOGGLE_URL: url })
  const check = () => h.app.evaluate(() => (globalThis as unknown as { scbVpn: { checkTunToggle(): Promise<void> } }).scbVpn.checkTunToggle())
  await setSetting(h, { vpnScope: 'computer', vpnMethod: 'tun' })
  await go(h, 'sc://vpn')
  const page = await h.page('sc://vpn')
  const tun = page.getByRole('radio', { name: /TUN/ })
  await expect(tun).toBeChecked()

  toggle = 'off\n'
  await check()
  await page.reload()
  await expect(tun).toBeDisabled()
  await expect(page.getByRole('radio', { name: /System proxy/ })).toBeChecked()
  await expect(page.getByText('TUN is off for now.')).toBeVisible()

  toggle = 'on\n'
  await check()
  await page.reload()
  // Not checked as enabled: CI has no pkexec, so TUN stays unavailable there for its own reason.
  await expect(page.getByText('TUN is off for now.')).toHaveCount(0)
  await expect(page.getByRole('radio', { name: /System proxy/ })).toBeChecked()
})
