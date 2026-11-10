import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { accessSync, constants, existsSync } from 'node:fs'
import { chmod, copyFile, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const DEVICE = 'scterra0'
const MARK = 0x5c7e
const TABLE = 5342
/** Long enough to find and type a password. */
const START_MS = 120_000

export interface TunnelHandle {
  /** Resolves once the routes are gone. */
  stop: () => Promise<void>
}

export interface TunnelStart {
  corePath: string
  config: (device: { device: string; mark?: number; autoRoute?: boolean; gateway?: string[]; dns?: string[]; routes?: string[] }) => unknown
  onExit: () => void
  isCancelled: () => boolean
}

export interface Tunnel {
  resolve: (host: string) => Promise<string>
  start: (options: TunnelStart) => Promise<TunnelHandle>
}

/**
 * Runs as root, for as long as its stdin stays open. So if scTerra stops for any reason, even
 * a crash, the pipe closes and the routes come out, leaving the computer's internet working.
 * The rules are the ones WireGuard uses: everything goes to the device, apart from the core's
 * own marked traffic and anything more specific than the default route, such as the local network.
 */
export const TUN_SCRIPT = `
PATH=/usr/sbin:/usr/bin:/sbin:/bin
source=$1 hash=$2 device=$3 mark=$4 table=$5
rules() {
  for family in -4 -6; do
    ip $family rule $1 not fwmark $mark table $table priority 9000
    ip $family rule $1 table main suppress_prefixlength 0 priority 8999
  done
} 2>/dev/null
down() {
  rules del
  ip -4 route flush table $table 2>/dev/null
  ip -6 route flush table $table 2>/dev/null
  [ -n "$pid" ] && kill "$pid" 2>/dev/null
  [ -n "$holder" ] && kill "$holder" 2>/dev/null
  [ -n "$dir" ] && rm -rf "$dir"
}
trap down EXIT
trap 'exit 0' HUP INT TERM
# A run that was killed outright can't have tidied up after itself.
rules del
IFS= read -r config || exit 0
# Not /run or /tmp, which are usually mounted so that nothing can be run from them.
dir=$(mktemp -d /var/lib/scterra-XXXXXX) || exit 10
# Copied where only root can write, then checked, as what's about to run as root came from a user's folder.
cp "$source" "$dir/xray" || exit 11
[ "$(sha256sum "$dir/xray" | cut -d' ' -f1)" = "$hash" ] || exit 12
chmod 700 "$dir/xray"
printf %s "$config" | base64 -d | "$dir/xray" run -c stdin: &
pid=$!
tries=0
until ip link show "$device" >/dev/null 2>&1; do
  kill -0 "$pid" 2>/dev/null || exit 13
  tries=$((tries + 1))
  [ "$tries" -gt 100 ] && exit 14
  sleep 0.1
done
ip addr add 172.19.0.1/30 dev "$device"
ip -6 addr add fd7a:5c7e::1/126 dev "$device" 2>/dev/null
ip link set "$device" up
ip -4 route add default dev "$device" table $table || exit 15
ip -6 route add default dev "$device" table $table 2>/dev/null
rules add
echo READY
exec 3<&0
( while IFS= read -r _; do :; done; kill "$pid" 2>/dev/null ) <&3 &
holder=$!
wait "$pid"
`

const REASONS: Record<number, string> = {
  126: 'Whole-computer TUN needs your permission, and the request was cancelled.',
  11: "The VPN core couldn't be set up to run.",
  10: "A safe folder for the VPN core couldn't be made.",
  12: "The VPN core didn't match its check, so it wasn't started.",
  13: "That connection didn't start. Its settings may not work with TUN.",
  14: "The network device didn't appear in time.",
  15: "The network routes couldn't be set."
}

/** Why pkexec said no. It exits 127 for all of these, so its own words are what tell them apart. */
export function refusedReason(stderr: string, isAdmin: boolean): string {
  if (/no authentication agent/i.test(stderr)) return "TUN needs a password, but nothing on this desktop can ask for one. Start your desktop's polkit agent, or use the system proxy instead."
  if (!isAdmin) return "TUN needs an administrator's password, and this account isn't an administrator on this computer. Enter an administrator's password when asked, have one add you to the sudo group, or use the system proxy instead."
  return "Linux didn't accept that password, so TUN wasn't set up. Try again, or use the system proxy instead."
}

/** Whether polkit counts this account as an administrator, which is membership of these groups on most systems. */
async function isAdministrator(): Promise<boolean> {
  const groups = await readFile('/etc/group', 'utf8').catch(() => '')
  const ids = new Set(process.getgroups?.() ?? [])
  return groups.split('\n').some((line) => {
    const [name, , id] = line.split(':')
    return (name === 'sudo' || name === 'wheel' || name === 'admin') && ids.has(Number(id))
  })
}

const onPath = (command: string) =>
  (process.env.PATH ?? '').split(':').some((folder) => {
    try {
      accessSync(join(folder, command), constants.X_OK)
      return true
    } catch {
      return false
    }
  })

async function start({ corePath, config, onExit, isCancelled }: TunnelStart): Promise<TunnelHandle> {
  // Root can't read inside a running AppImage's mount, so it's given a copy to check and take.
  const folder = await mkdtemp(join(tmpdir(), 'scterra-tun-'))
  const copy = join(folder, 'xray')
  await copyFile(corePath, copy)
  const hash = createHash('sha256').update(await readFile(copy)).digest('hex')
  const child = spawn('pkexec', ['/bin/sh', '-c', TUN_SCRIPT, 'scterra-tun', copy, hash, DEVICE, String(MARK), String(TABLE)], { stdio: ['pipe', 'pipe', 'pipe'] })
  let errors = ''
  child.stderr.on('data', (data: Buffer) => (errors = (errors + data.toString()).slice(-400)))
  child.stdin.on('error', () => undefined)
  // It holds passwords, so it goes through the pipe rather than the command line.
  child.stdin.write(`${Buffer.from(JSON.stringify(config({ device: DEVICE, mark: MARK }))).toString('base64')}\n`)

  const exited = new Promise<number | null>((resolve) => {
    child.once('exit', (code) => resolve(code))
    child.once('error', () => resolve(127))
  })
  const stop = () => {
    // It runs as root, so it can't be signalled. Closing the pipe is what tells it to finish.
    child.stdin.end()
    return exited.then(() => undefined)
  }
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('TUN took too long to start.')), START_MS)
      child.stdout.on('data', (data: Buffer) => {
        if (!data.toString().includes('READY')) return
        clearTimeout(timer)
        resolve()
      })
      void exited.then(async (code) => {
        clearTimeout(timer)
        reject(new Error(code === 127 ? refusedReason(errors, await isAdministrator()) : (REASONS[code ?? -1] ?? "TUN didn't start.")))
      })
    })
  } catch (error) {
    void stop()
    throw error
  } finally {
    await rm(folder, { recursive: true, force: true })
  }
  if (isCancelled()) {
    await stop()
    throw new Error('Cancelled.')
  }
  void exited.then(onExit)
  return { stop }
}

/** A unit high enough to be free, as macOS's own VPNs and iCloud Private Relay take the low ones. */
const MAC_DEVICE = 'utun77'

/**
 * The macOS version runs as root through the system's own password box. That box can't pass a
 * pipe along, so this script watches a folder that only this account can reach: the config
 * arrives as a file it reads once and deletes, and it says READY in another. It stops when the
 * `alive` file goes, when scTerra's process is gone (even after a crash), or when the core
 * stops. Xray adds the routes itself, and takes them out again when it's stopped.
 */
export const MAC_TUN_SCRIPT = `
PATH=/usr/sbin:/usr/bin:/sbin:/bin
source=$1 hash=$2 control=$3 app=$4 device=$5
down() {
  [ -n "$pid" ] && kill "$pid" 2>/dev/null && wait "$pid" 2>/dev/null
  rm -f "$control/config"
  [ -n "$dir" ] && rm -rf "$dir"
}
trap down EXIT
trap 'exit 0' HUP INT TERM
dir=$(mktemp -d /var/run/scterra-XXXXXX) || exit 10
cp "$source" "$dir/xray" || exit 11
[ "$(shasum -a 256 "$dir/xray" | cut -d' ' -f1)" = "$hash" ] || exit 12
chmod 700 "$dir/xray"
"$dir/xray" run -c stdin: < "$control/config" >/dev/null 2>&1 &
pid=$!
tries=0
until ifconfig "$device" >/dev/null 2>&1; do
  kill -0 "$pid" 2>/dev/null || exit 13
  tries=$((tries + 1))
  [ "$tries" -gt 100 ] && exit 14
  sleep 0.1
done
rm -f "$control/config"
echo READY > "$control/status"
while kill -0 "$pid" 2>/dev/null && kill -0 "$app" 2>/dev/null && [ -e "$control/alive" ]; do sleep 1; done
`

/** AppleScript's password box, given the script and its values as arguments so nothing needs quoting. */
const ASK_AS_ADMIN = [
  'on run argv',
  'set command to "/bin/sh -c " & quoted form of (item 1 of argv) & " scterra-tun"',
  'repeat with value in rest of argv',
  'set command to command & " " & quoted form of value',
  'end repeat',
  'do shell script command with administrator privileges',
  'end run'
]

async function startMac({ corePath, config, onExit, isCancelled }: TunnelStart): Promise<TunnelHandle> {
  const control = await mkdtemp(join(tmpdir(), 'scterra-tun-'))
  await chmod(control, 0o700)
  const copy = join(control, 'xray')
  await copyFile(corePath, copy)
  const hash = createHash('sha256').update(await readFile(copy)).digest('hex')
  // It holds passwords, so it's only readable by this account, and root deletes it once read.
  await writeFile(join(control, 'config'), JSON.stringify(config({ device: MAC_DEVICE, autoRoute: true })), { mode: 0o600 })
  await writeFile(join(control, 'alive'), '')
  const args = ASK_AS_ADMIN.flatMap((line) => ['-e', line])
  const child = spawn('osascript', [...args, MAC_TUN_SCRIPT, copy, hash, control, String(process.pid), MAC_DEVICE], { stdio: ['ignore', 'ignore', 'pipe'] })
  let errors = ''
  child.stderr.on('data', (data: Buffer) => (errors = (errors + data.toString()).slice(-400)))
  const exited = new Promise<number | null>((resolve) => {
    child.once('exit', (code) => {
      if (code === 0 || code === null) return resolve(code)
      // osascript ends with the script's own status in brackets, or -128 when the box is cancelled.
      const status = Number(/\((-?\d+)\)\s*$/.exec(errors.trim())?.[1] ?? code)
      resolve(status === -128 ? 126 : status)
    })
    child.once('error', () => resolve(127))
  })
  const tidy = () => rm(control, { recursive: true, force: true }).catch(() => undefined)
  const stop = async () => {
    // Root's script notices this within a second, and Xray takes its routes out as it stops.
    await rm(join(control, 'alive'), { force: true })
    await exited
    await tidy()
  }
  try {
    await new Promise<void>((resolve, reject) => {
      const deadline = Date.now() + START_MS
      let done = false
      void exited.then((code) => {
        if (done) return
        done = true
        reject(new Error(REASONS[code ?? -1] ?? "TUN didn't start."))
      })
      const check = async () => {
        if (done) return
        const ready = await stat(join(control, 'status')).then(() => true, () => false)
        if (ready) {
          done = true
          return resolve()
        }
        if (Date.now() > deadline) {
          done = true
          return reject(new Error('TUN took too long to start.'))
        }
        setTimeout(() => void check(), 150)
      }
      void check()
    })
  } catch (error) {
    void stop()
    throw error
  } finally {
    await rm(copy, { force: true })
  }
  if (isCancelled()) {
    await stop()
    throw new Error('Cancelled.')
  }
  void exited.then(() => {
    void tidy()
    onExit()
  })
  return { stop }
}

/** Windows names the adapter after this, and Xray asks wintun for it by name. */
const WINDOWS_DEVICE = 'scTerra'

/**
 * What the Windows adapter is given. Without its own addresses it only gets a link-local one a
 * few seconds after starting, and routes through it don't take. The two halves of each address
 * space are more specific than the computer's default route, so they win over it whatever its
 * metric, as WireGuard and OpenVPN do it; Xray binds its own connections to the real adapter.
 */
export const WINDOWS_TUN = {
  device: WINDOWS_DEVICE,
  gateway: ['172.19.0.1/30', 'fd7a:5c7e::1/126'],
  dns: ['1.1.1.1'],
  routes: ['0.0.0.0/1', '128.0.0.0/1', '::/1', '8000::/1']
}

/** A value for a single-quoted PowerShell string. */
const psQuote = (value: string) => `'${value.replace(/'/g, "''")}'`

/**
 * The Windows version, run as an administrator after the system's own prompt. Like the Mac one,
 * that prompt can't pass a pipe, so this watches a folder only this account can reach. The core
 * and the wintun driver are copied somewhere only administrators can write and checked before
 * anything runs. It stops when the `alive` file goes, when scTerra's process is gone (even after
 * a crash), or when the core stops; wintun takes the adapter, and with it Xray's routes, away
 * as the core ends. It leaves its exit code in `result` and any error in `error`, as an elevated
 * process's exit code doesn't always reach the one that asked for it.
 */
export const windowsTunScript = ({ control, xrayHash, wintunHash, appPid, device }: { control: string; xrayHash: string; wintunHash: string; appPid: number; device: string }) => `
$ErrorActionPreference = 'Stop'
$control = ${psQuote(control)}
$core = $null
$dir = $null
$code = 0
function Quit([int]$n, [string]$why) {
  $script:code = $n
  if ($why) { Set-Content -LiteralPath (Join-Path $control 'error') -Value $why -ErrorAction SilentlyContinue }
  exit $n
}
try {
  $dir = Join-Path $env:SystemRoot ('Temp\\scterra-' + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $dir | Out-Null
  & icacls.exe $dir /inheritance:r /grant:r '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-18:(OI)(CI)F' | Out-Null
  if ($LASTEXITCODE -ne 0) { Quit 10 'icacls failed' }
  Copy-Item -LiteralPath (Join-Path $control 'xray.exe') -Destination $dir
  Copy-Item -LiteralPath (Join-Path $control 'wintun.dll') -Destination $dir
  if ((Get-FileHash -LiteralPath (Join-Path $dir 'xray.exe') -Algorithm SHA256).Hash -ne ${psQuote(xrayHash.toUpperCase())}) { Quit 12 'xray.exe' }
  if ((Get-FileHash -LiteralPath (Join-Path $dir 'wintun.dll') -Algorithm SHA256).Hash -ne ${psQuote(wintunHash.toUpperCase())}) { Quit 12 'wintun.dll' }
  # It holds passwords, so it's moved in behind the locked folder and gone once the core has read it.
  $config = Join-Path $dir 'config.json'
  Copy-Item -LiteralPath (Join-Path $control 'config') -Destination $config
  Remove-Item -LiteralPath (Join-Path $control 'config') -Force
  $out = Join-Path $dir 'out.txt'
  $core = Start-Process -FilePath (Join-Path $dir 'xray.exe') -ArgumentList 'run', '-c', ('"' + $config + '"') -WorkingDirectory $dir -NoNewWindow -PassThru -RedirectStandardOutput $out -RedirectStandardError (Join-Path $dir 'err.txt')
  $tries = 0
  while (-not (Get-NetAdapter -Name ${psQuote(device)} -ErrorAction SilentlyContinue)) {
    if ($core.HasExited) {
      $said = ((Get-Content -LiteralPath $out, (Join-Path $dir 'err.txt') -ErrorAction SilentlyContinue) -join ' ')
      Quit 13 ($said.Substring([Math]::Max(0, $said.Length - 400)))
    }
    $tries++
    if ($tries -gt 150) { Quit 14 '' }
    Start-Sleep -Milliseconds 100
  }
  Remove-Item -LiteralPath $config -Force -ErrorAction SilentlyContinue
  Set-Content -LiteralPath (Join-Path $control 'status') -Value 'READY'
  while (-not $core.HasExited -and (Get-Process -Id ${appPid} -ErrorAction SilentlyContinue) -and (Test-Path -LiteralPath (Join-Path $control 'alive'))) { Start-Sleep -Seconds 1 }
  exit 0
} catch {
  $code = 11
  Set-Content -LiteralPath (Join-Path $control 'error') -Value $_.Exception.Message -ErrorAction SilentlyContinue
  exit 11
} finally {
  if ($core -and -not $core.HasExited) { Stop-Process -Id $core.Id -Force -ErrorAction SilentlyContinue; $core.WaitForExit(3000) | Out-Null }
  if ($dir) { Remove-Item -LiteralPath $dir -Recurse -Force -ErrorAction SilentlyContinue }
  Remove-Item -LiteralPath (Join-Path $control 'config') -Force -ErrorAction SilentlyContinue
  Set-Content -LiteralPath (Join-Path $control 'result') -Value $code -ErrorAction SilentlyContinue
}
`

/**
 * What the admin prompt runs. The script itself is several thousand characters once encoded, more
 * than an elevated command line reliably carries, so it's read from the control folder and only
 * run if it matches the hash given here. Reading and checking the same text closes any gap between.
 */
export const windowsBootstrap = (scriptPath: string, scriptHash: string) =>
  `$s = [IO.File]::ReadAllText(${psQuote(scriptPath)}); ` +
  `$h = [BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($s))).Replace('-', ''); ` +
  `if ($h -ne ${psQuote(scriptHash.toUpperCase())}) { exit 12 }; ` +
  `& ([ScriptBlock]::Create($s)); exit $LASTEXITCODE`

/** PowerShell's -EncodedCommand takes UTF-16 little-endian, in base64. */
const encodePowerShell = (script: string) => Buffer.from(script, 'utf16le').toString('base64')

/** Why the elevated script stopped: its own record first, as the process's exit code can be lost. */
export async function windowsExitReason(control: string, code: number | null): Promise<string> {
  const recorded = Number.parseInt(await readFile(join(control, 'result'), 'utf8').catch(() => ''), 10)
  const detail = (await readFile(join(control, 'error'), 'utf8').catch(() => '')).trim()
  const known = Number.isNaN(recorded) ? code : recorded
  const reason = REASONS[known ?? -1] ?? "TUN didn't start."
  return detail && known !== 12 && known !== 14 ? `${reason} Windows said: ${detail.slice(0, 300)}` : reason
}

async function startWindows({ corePath, config, onExit, isCancelled }: TunnelStart): Promise<TunnelHandle> {
  const driver = join(dirname(corePath), 'wintun.dll')
  if (!existsSync(driver)) throw new Error("This copy of scTerra doesn't include the wintun driver that TUN needs on Windows. Use the system proxy instead.")
  const control = await mkdtemp(join(tmpdir(), 'scterra-tun-'))
  const hashOf = async (path: string) => createHash('sha256').update(await readFile(path)).digest('hex')
  await copyFile(corePath, join(control, 'xray.exe'))
  await copyFile(driver, join(control, 'wintun.dll'))
  const xrayHash = await hashOf(join(control, 'xray.exe'))
  const wintunHash = await hashOf(join(control, 'wintun.dll'))
  // The folder sits in this account's own temp folder, which other accounts can't read.
  await writeFile(join(control, 'config'), JSON.stringify(config(WINDOWS_TUN)))
  await writeFile(join(control, 'alive'), '')
  const script = windowsTunScript({ control, xrayHash, wintunHash, appPid: process.pid, device: WINDOWS_DEVICE })
  const scriptPath = join(control, 'tun.ps1')
  await writeFile(scriptPath, script, 'utf8')
  const inner = encodePowerShell(windowsBootstrap(scriptPath, createHash('sha256').update(script, 'utf8').digest('hex')))
  // Start-Process -Verb RunAs shows Windows' own prompt. Cancelling it throws, which reads as 126.
  const outer = `try { $p = Start-Process -FilePath powershell.exe -Verb RunAs -WindowStyle Hidden -PassThru -Wait -ArgumentList '-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand','${inner}'; exit $p.ExitCode } catch { exit 126 }`
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', outer], { stdio: 'ignore', windowsHide: true })
  const exited = new Promise<number | null>((resolve) => {
    child.once('exit', (code) => resolve(code))
    child.once('error', () => resolve(127))
  })
  const tidy = () => rm(control, { recursive: true, force: true }).catch(() => undefined)
  const stop = async () => {
    await rm(join(control, 'alive'), { force: true })
    await exited
    await tidy()
  }
  try {
    await new Promise<void>((resolve, reject) => {
      const deadline = Date.now() + START_MS
      let done = false
      void exited.then(async (code) => {
        if (done) return
        done = true
        reject(new Error(await windowsExitReason(control, code)))
      })
      const check = async () => {
        if (done) return
        if (await stat(join(control, 'status')).then(() => true, () => false)) {
          done = true
          return resolve()
        }
        if (Date.now() > deadline) {
          done = true
          return reject(new Error('TUN took too long to start.'))
        }
        setTimeout(() => void check(), 150)
      }
      void check()
    })
  } catch (error) {
    void stop()
    throw error
  } finally {
    await rm(join(control, 'xray.exe'), { force: true })
    await rm(join(control, 'wintun.dll'), { force: true })
  }
  if (isCancelled()) {
    await stop()
    throw new Error('Cancelled.')
  }
  void exited.then(() => {
    void tidy()
    onExit()
  })
  return { stop }
}

const resolve = async (host: string) => (await lookup(host)).address

/** Linux through pkexec, macOS through its password box, and Windows through its admin prompt with the bundled wintun driver. */
export const tunnelFor = (): Tunnel | null => {
  if (process.platform === 'linux') return onPath('pkexec') ? { resolve, start } : null
  if (process.platform === 'darwin') return { resolve, start: startMac }
  if (process.platform === 'win32') return { resolve, start: startWindows }
  return null
}
