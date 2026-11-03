import { execFileSync, spawn } from 'node:child_process'

export interface ProxyPorts {
  host: string
  httpPort: number
  socksPort: number
}

type Command = [string, ...string[]]
type Run = (command: Command) => string

/** One desktop's proxy setting. Changes are lists of commands, so a watcher can run them after a crash. */
interface Backend {
  read: () => unknown
  apply: (ports: ProxyPorts) => Command[]
  restore: (saved: never) => Command[]
}

export interface SystemProxy {
  /** The current setting, as text to hand back to `restore`. */
  read: () => string
  apply: (ports: ProxyPorts) => void
  restore: (saved: string) => void
  /** Restores the setting if scTerra dies, so the computer doesn't lose the internet with it. */
  watchForCrash: (saved: string) => { stop: () => void }
}

const KDE_KEYS = ['ProxyType', 'httpProxy', 'httpsProxy', 'ftpProxy', 'socksProxy'] as const

function kde(run: Run, version: string): Backend {
  const write = (key: string, value: string): Command =>
    value
      ? [`kwriteconfig${version}`, '--file', 'kioslaverc', '--group', 'Proxy Settings', '--key', key, value]
      : [`kwriteconfig${version}`, '--file', 'kioslaverc', '--group', 'Proxy Settings', '--key', key, '--delete']
  // Running apps only notice a change through this signal.
  const notify: Command = ['dbus-send', '--type=signal', '/KIO/Scheduler', 'org.kde.KIO.Scheduler.reparseSlaveConfiguration', "string:''"]
  return {
    read: () => Object.fromEntries(KDE_KEYS.map((key) => [key, run([`kreadconfig${version}`, '--file', 'kioslaverc', '--group', 'Proxy Settings', '--key', key]).trim()])),
    apply: ({ host, httpPort, socksPort }) => [
      write('ProxyType', '1'),
      write('httpProxy', `http://${host} ${httpPort}`),
      write('httpsProxy', `http://${host} ${httpPort}`),
      write('ftpProxy', `http://${host} ${httpPort}`),
      write('socksProxy', `socks://${host} ${socksPort}`),
      notify
    ],
    restore: (saved: Record<string, string>) => [...KDE_KEYS.map((key) => write(key, saved[key] ?? '')), notify]
  }
}

const GNOME_KEYS = [
  ['org.gnome.system.proxy', 'mode'],
  ['org.gnome.system.proxy.http', 'host'],
  ['org.gnome.system.proxy.http', 'port'],
  ['org.gnome.system.proxy.https', 'host'],
  ['org.gnome.system.proxy.https', 'port'],
  ['org.gnome.system.proxy.socks', 'host'],
  ['org.gnome.system.proxy.socks', 'port']
] as const

function gnome(run: Run): Backend {
  const set = (schema: string, key: string, value: string): Command => ['gsettings', 'set', schema, key, value]
  return {
    read: () => GNOME_KEYS.map(([schema, key]) => run(['gsettings', 'get', schema, key]).trim()),
    apply: ({ host, httpPort, socksPort }) => [
      set('org.gnome.system.proxy.http', 'host', host),
      set('org.gnome.system.proxy.http', 'port', String(httpPort)),
      set('org.gnome.system.proxy.https', 'host', host),
      set('org.gnome.system.proxy.https', 'port', String(httpPort)),
      set('org.gnome.system.proxy.socks', 'host', host),
      set('org.gnome.system.proxy.socks', 'port', String(socksPort)),
      set('org.gnome.system.proxy', 'mode', 'manual')
    ],
    restore: (saved: string[]) => GNOME_KEYS.map(([schema, key], index) => set(schema, key, saved[index] ?? ''))
  }
}

const WINDOWS_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'
// Without this, apps that are already open keep the old setting until they restart.
const WINDOWS_NOTIFY: Command = [
  'powershell',
  '-NoProfile',
  '-Command',
  "$s='[DllImport(\"wininet.dll\")]public static extern bool InternetSetOption(int a,int b,int c,int d);';$t=Add-Type -MemberDefinition $s -Name W -PassThru;[void]$t::InternetSetOption(0,39,0,0);[void]$t::InternetSetOption(0,37,0,0)"
]

function windows(run: Run): Backend {
  const value = (name: string) => {
    try {
      return /REG_\w+\s+(.*)$/m.exec(run(['reg', 'query', WINDOWS_KEY, '/v', name]))?.[1]?.trim() ?? ''
    } catch {
      return ''
    }
  }
  const write = (name: string, type: string, data: string): Command => ['reg', 'add', WINDOWS_KEY, '/v', name, '/t', type, '/d', data, '/f']
  return {
    read: () => ({ enable: value('ProxyEnable'), server: value('ProxyServer') }),
    apply: ({ host, httpPort, socksPort }) => [
      write('ProxyServer', 'REG_SZ', `http=${host}:${httpPort};https=${host}:${httpPort};socks=${host}:${socksPort}`),
      write('ProxyEnable', 'REG_DWORD', '1'),
      WINDOWS_NOTIFY
    ],
    restore: (saved: { enable: string; server: string }) => [
      saved.server ? write('ProxyServer', 'REG_SZ', saved.server) : ['reg', 'delete', WINDOWS_KEY, '/v', 'ProxyServer', '/f'],
      write('ProxyEnable', 'REG_DWORD', saved.enable === '0x1' ? '1' : '0'),
      WINDOWS_NOTIFY
    ]
  }
}

const MAC_KINDS = [
  ['web', '-getwebproxy', '-setwebproxy', '-setwebproxystate'],
  ['secure', '-getsecurewebproxy', '-setsecurewebproxy', '-setsecurewebproxystate'],
  ['socks', '-getsocksfirewallproxy', '-setsocksfirewallproxy', '-setsocksfirewallproxystate']
] as const

function mac(run: Run): Backend {
  // The first line is a notice, and a leading * marks a service that's turned off.
  const services = () => run(['networksetup', '-listallnetworkservices']).split('\n').slice(1).filter((line) => line && !line.startsWith('*'))
  const field = (text: string, name: string) => new RegExp(`^${name}: (.*)$`, 'm').exec(text)?.[1] ?? ''
  return {
    read: () =>
      Object.fromEntries(
        services().map((service) => [
          service,
          MAC_KINDS.map(([kind, get]) => {
            const text = run(['networksetup', get, service])
            return { kind, on: field(text, 'Enabled') === 'Yes', server: field(text, 'Server'), port: field(text, 'Port') }
          })
        ])
      ),
    apply: ({ host, httpPort, socksPort }) =>
      services().flatMap((service) =>
        MAC_KINDS.map(([kind, , setter]): Command => ['networksetup', setter, service, host, String(kind === 'socks' ? socksPort : httpPort)])
      ),
    restore: (saved: Record<string, { kind: string; on: boolean; server: string; port: string }[]>) =>
      Object.entries(saved).flatMap(([service, kinds]) =>
        kinds.flatMap(({ kind, on, server, port }): Command[] => {
          const [, , setter, stater] = MAC_KINDS.find(([name]) => name === kind)!
          return [...(server ? [['networksetup', setter, service, server, port] as Command] : []), ['networksetup', stater, service, on ? 'on' : 'off']]
        })
      )
  }
}

/** An AppImage's library path breaks system tools, so they get the environment they'd normally have. */
function cleanEnv(): NodeJS.ProcessEnv {
  const { LD_LIBRARY_PATH: _library, LD_PRELOAD: _preload, ...env } = process.env
  return env
}

const execRun: Run = ([command, ...args]) => execFileSync(command, args, { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'], env: cleanEnv() })

const works = (run: Run, command: Command) => {
  try {
    run(command)
    return true
  } catch {
    return false
  }
}

/** The settings this computer has. KDE apps read KDE's, while GTK apps on KDE still read GNOME's, so both get set. */
export function detectBackends(platform: NodeJS.Platform, desktop: string, run: Run): Backend[] {
  if (platform === 'win32') return [windows(run)]
  if (platform === 'darwin') return [mac(run)]
  if (platform !== 'linux') return []
  const found: Backend[] = []
  if (/kde/i.test(desktop)) {
    const version = ['6', '5'].find((candidate) => works(run, [`kreadconfig${candidate}`, '--file', 'kioslaverc', '--group', 'Proxy Settings', '--key', 'ProxyType']))
    if (version) found.push(kde(run, version))
  }
  if (works(run, ['gsettings', 'get', 'org.gnome.system.proxy', 'mode'])) found.push(gnome(run))
  return found
}

// Runs in its own process, outliving the app: waits for it to go, then runs each command.
export const WATCHER = `
const { execFileSync } = require('node:child_process')
const [pid, commands] = process.argv.slice(1)
setInterval(() => {
  try { process.kill(Number(pid), 0) } catch {
    for (const [command, ...args] of JSON.parse(commands)) {
      try { execFileSync(command, args, { stdio: 'ignore', timeout: 5000 }) } catch {}
    }
    process.exit(0)
  }
}, 1000)
`

const NOTIFIERS = ['dbus-send', 'powershell']

export function makeSystemProxy(backends: Backend[], run: Run): SystemProxy | null {
  if (backends.length === 0) return null
  const restoring = (saved: string) => backends.flatMap((backend, index) => backend.restore((JSON.parse(saved) as never[])[index]!))
  const runAll = (commands: Command[]) => {
    for (const command of commands) {
      try {
        run(command)
      } catch (error) {
        // Telling running apps is a courtesy: the setting itself has already changed.
        if (!NOTIFIERS.includes(command[0])) throw error
      }
    }
  }
  return {
    read: () => JSON.stringify(backends.map((backend) => backend.read())),
    apply: (ports) => runAll(backends.flatMap((backend) => backend.apply(ports))),
    restore: (saved) => runAll(restoring(saved)),
    watchForCrash: (saved) => {
      const watcher = spawn(process.execPath, ['-e', WATCHER, String(process.pid), JSON.stringify(restoring(saved))], {
        detached: true,
        stdio: 'ignore',
        env: { ...cleanEnv(), ELECTRON_RUN_AS_NODE: '1' }
      })
      watcher.unref()
      return { stop: () => void watcher.kill() }
    }
  }
}

export const systemProxyFor = () => makeSystemProxy(detectBackends(process.platform, process.env.XDG_CURRENT_DESKTOP ?? '', execRun), execRun)
