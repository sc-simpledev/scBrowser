import { createHash } from 'node:crypto'
import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { app, nativeImage, shell } from 'electron'
import type { WebApp } from '@scbrowser/shared'
import { currentProfile, DEFAULT_PROFILE } from './profiles'
import type { KeyValueRepo } from './storage/kv'

const KEY = 'web-apps'
export const WEB_APP_FLAG = '--sc-app='

interface Installed extends WebApp {
  /** Everything to delete when it's removed. */
  files: string[]
}

/** The address an installed app's shortcut asks for. Only ever the web. */
export function webAppUrlFromArgv(argv: string[]): string | null {
  const url = argv.find((arg) => arg.startsWith(WEB_APP_FLAG))?.slice(WEB_APP_FLAG.length)
  return url && URL.canParse(url) && /^https?:$/.test(new URL(url).protocol) ? url : null
}

/** What starts this copy of the browser. An AppImage's real path is outside its temporary mount. */
function launchCommand(url: string): string[] {
  return [
    process.env.APPIMAGE ?? process.execPath,
    ...(app.isPackaged ? [] : [app.getAppPath()]),
    ...(currentProfile() === DEFAULT_PROFILE ? [] : [`--profile=${currentProfile()}`]),
    `${WEB_APP_FLAG}${url}`
  ]
}

/** The Desktop Entry spec's two rounds of escaping, then its own for field codes. */
export function desktopExec(args: string[]): string {
  return args.map((arg) => `"${arg.replace(/[\\"`$]/g, '\\$&').replace(/\\/g, '\\\\').replace(/%/g, '%%')}"`).join(' ')
}

export const desktopEntry = (name: string, args: string[], icon: string) =>
  ['[Desktop Entry]', 'Type=Application', `Name=${name.replace(/[\r\n]+/g, ' ')}`, `Exec=${desktopExec(args)}`, `Icon=${icon}`, 'Terminal=false', 'Categories=Network;', 'StartupWMClass=scTerra', ''].join('\n')

const xml = (text: string) => text.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`)
const shellQuote = (text: string) => `'${text.replaceAll("'", `'\\''`)}'`
/** Safe as a file name on every system. */
const fileName = (name: string) => name.replace(/[\\/:*?"<>|\r\n]+/g, ' ').trim().slice(0, 60) || 'Web app'

/** Sites installed as apps: a shortcut in the system's own menu that opens a window with no tabs. */
export class WebApps {
  constructor(private readonly kv: KeyValueRepo) {}

  private all(): Installed[] {
    return (this.kv.get(KEY) as Installed[] | undefined) ?? []
  }

  list(): WebApp[] {
    return this.all().map(({ id, name, url }) => ({ id, name, url }))
  }

  /** Installing the same address again replaces it. `icon` is a data address, if the site has one. */
  install(name: string, url: string, icon: string | null): WebApp {
    const id = createHash('sha256').update(url).digest('hex').slice(0, 16)
    this.remove(id)
    const folder = join(app.getPath('userData'), 'web-apps')
    mkdirSync(folder, { recursive: true })
    const image = icon ? nativeImage.createFromDataURL(icon) : null
    const iconPath = join(folder, `${id}.png`)
    const hasIcon = !!image && !image.isEmpty()
    if (hasIcon) writeFileSync(iconPath, image.resize({ width: 128, height: 128 }).toPNG())
    const files = [...(hasIcon ? [iconPath] : []), ...this.shortcut(id, fileName(name), url, hasIcon ? iconPath : null)]
    const installed: Installed = { id, name: fileName(name), url, files }
    this.kv.set(KEY, [...this.all(), installed])
    return { id, name: installed.name, url }
  }

  remove(id: string): void {
    const found = this.all().find((entry) => entry.id === id)
    if (!found) return
    // Only files this class recorded when it made them.
    for (const file of found.files) rmSync(file, { recursive: true, force: true })
    this.kv.set(KEY, this.all().filter((entry) => entry.id !== id))
  }

  private shortcut(id: string, name: string, url: string, icon: string | null): string[] {
    const args = launchCommand(url)
    if (process.platform === 'win32') {
      const programs = join(app.getPath('appData'), 'Microsoft/Windows/Start Menu/Programs', `${name}.lnk`)
      shell.writeShortcutLink(programs, { target: args[0]!, args: args.slice(1).map((arg) => `"${arg}"`).join(' '), description: name })
      return [programs]
    }
    if (process.platform === 'darwin') return [this.macBundle(id, name, args)]
    const dataHome = process.env.XDG_DATA_HOME || join(homedir(), '.local/share')
    const folder = join(dataHome, 'applications')
    mkdirSync(folder, { recursive: true })
    const path = join(folder, `scterra-app-${id}.desktop`)
    writeFileSync(path, desktopEntry(name, args, icon ?? 'scterra'))
    chmodSync(path, 0o755)
    return [path]
  }

  /** A tiny bundle in ~/Applications. Its script hands over to the running browser and ends. */
  private macBundle(id: string, name: string, args: string[]): string {
    const bundle = join(homedir(), 'Applications', `${name}.app`)
    const macos = join(bundle, 'Contents/MacOS')
    mkdirSync(macos, { recursive: true })
    const plist = `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict><key>CFBundleName</key><string>${xml(name)}</string><key>CFBundleIdentifier</key><string>app.scterra.webapp.${id}</string><key>CFBundleExecutable</key><string>run</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>\n`
    writeFileSync(join(bundle, 'Contents/Info.plist'), plist)
    writeFileSync(join(macos, 'run'), `#!/bin/sh\nexec ${args.map(shellQuote).join(' ')}\n`)
    chmodSync(join(macos, 'run'), 0o755)
    return bundle
  }
}
