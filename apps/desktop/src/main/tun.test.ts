import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { xrayComputerConfig } from '@scbrowser/shared'
import { refusedReason, TUN_SCRIPT, WINDOWS_TUN, windowsBootstrap, windowsExitReason, windowsTunScript } from './tun'

describe('TUN on Linux', () => {
  it('never runs the core from /run, which is usually mounted noexec', () => {
    expect(TUN_SCRIPT).not.toMatch(/mktemp -d \/run/)
    expect(TUN_SCRIPT).toContain('mktemp -d /var/lib/')
  })
  it('says why polkit refused', () => {
    expect(refusedReason('Error executing command as another user: Not authorized', false)).toContain("isn't an administrator")
    expect(refusedReason('Error executing command as another user: Not authorized', true)).toContain("didn't accept that password")
    expect(refusedReason('Error executing command as another user: No authentication agent found.', true)).toContain('nothing on this desktop can ask')
  })
})

describe('TUN on Windows', () => {
  const script = windowsTunScript({ control: "C:\\Users\\o'brien\\AppData\\Local\\Temp\\scterra-tun-1", xrayHash: 'ab', wintunHash: 'cd', appPid: 42, device: 'scTerra' })

  it('locks the core into a folder under Windows\\Temp, with quotes in paths escaped', () => {
    // A lone backslash in the template used to vanish, which made the folder C:\Windows\Tempscterra-….
    expect(script).toContain("'Temp\\scterra-'")
    expect(script).toContain("'C:\\Users\\o''brien\\AppData\\Local\\Temp\\scterra-tun-1'")
    expect(script).toContain("-ne 'AB'")
  })

  it('records why it stopped, as an elevated exit code can be lost', () => {
    expect(script).toContain("(Join-Path $control 'result') -Value $code")
    expect(script).toContain('-RedirectStandardOutput $out')
  })

  it('gives the adapter addresses, DNS and routes more specific than the default', () => {
    const config = xrayComputerConfig({ protocol: 'socks', host: 'h', port: 1, name: 'n' } as never, { socksPort: 1080, tun: { ...WINDOWS_TUN, serverAddress: '1.2.3.4' } }) as { inbounds: { protocol: string; settings: Record<string, unknown> }[] }
    expect(config.inbounds.find((inbound) => inbound.protocol === 'tun')?.settings).toMatchObject({
      name: 'scTerra',
      gateway: ['172.19.0.1/30', 'fd7a:5c7e::1/126'],
      dns: ['1.1.1.1'],
      autoSystemRoutingTable: ['0.0.0.0/1', '128.0.0.0/1', '::/1', '8000::/1'],
      autoOutboundsInterface: 'auto'
    })
  })

  it('runs the script only if it matches its hash', () => {
    const boot = windowsBootstrap('C:\\t\\tun.ps1', 'ff')
    expect(boot).toContain("ReadAllText('C:\\t\\tun.ps1')")
    expect(boot).toContain("-ne 'FF') { exit 12 }")
  })

  it('reads the reason the script left behind', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'tun-'))
    writeFileSync(join(folder, 'result'), '13\r\n')
    writeFileSync(join(folder, 'error'), 'Failed to start: unknown protocol\r\n')
    expect(await windowsExitReason(folder, null)).toBe("That connection didn't start. Its settings may not work with TUN. Windows said: Failed to start: unknown protocol")
    expect(await windowsExitReason(mkdtempSync(join(tmpdir(), 'tun-')), 126)).toContain('cancelled')
  })
})
