import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: {}, nativeImage: {}, shell: {} }))
vi.mock('./profiles', () => ({ currentProfile: () => 'Default', DEFAULT_PROFILE: 'Default' }))

const { desktopEntry, desktopExec, webAppUrlFromArgv } = await import('./webApps')

describe('webAppUrlFromArgv', () => {
  it('only takes web addresses', () => {
    expect(webAppUrlFromArgv(['app', '--sc-app=https://a.example/x'])).toBe('https://a.example/x')
    expect(webAppUrlFromArgv(['app', '--sc-app=file:///etc/passwd'])).toBeNull()
    expect(webAppUrlFromArgv(['app', '--sc-app=sc://settings'])).toBeNull()
    expect(webAppUrlFromArgv(['app', 'https://a.example/'])).toBeNull()
  })
})

describe('desktop entries', () => {
  it("escapes paths like this repo's, and field codes in addresses", () => {
    expect(desktopExec(["/home/a/Alex's Folder/app", '--sc-app=https://a.example/?q=100%'])).toBe(`"/home/a/Alex's Folder/app" "--sc-app=https://a.example/?q=100%%"`)
    expect(desktopExec(['a"b$c`d'])).toBe('"a\\\\"b\\\\$c\\\\`d"')
  })

  it("can't be given extra lines by a page's title", () => {
    const entry = desktopEntry('Evil\nExec=rm -rf', ['/bin/app'], 'icon')
    expect(entry.match(/^Exec=/gm)).toHaveLength(1)
    expect(entry).toContain('Name=Evil Exec=rm -rf')
  })
})
