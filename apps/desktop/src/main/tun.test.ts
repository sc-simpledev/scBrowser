import { describe, expect, it } from 'vitest'
import { refusedReason, TUN_SCRIPT } from './tun'

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
