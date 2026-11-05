import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { accessSync, constants } from 'node:fs'
import { chmod, copyFile, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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
  config: (device: { device: string; mark?: number; autoRoute?: boolean }) => unknown
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
dir=$(mktemp -d /run/scterra-XXXXXX) || exit 10
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
  126: 'Whole-computer TUN needs your password, and the request was cancelled.',
  127: "This account isn't allowed to set up TUN.",
  12: "The VPN core didn't match its check, so it wasn't started.",
  13: "That connection didn't start. Its settings may not work with TUN.",
  14: "The network device didn't appear in time.",
  15: "The network routes couldn't be set."
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
  const child = spawn('pkexec', ['/bin/sh', '-c', TUN_SCRIPT, 'scterra-tun', copy, hash, DEVICE, String(MARK), String(TABLE)], { stdio: ['pipe', 'pipe', 'ignore'] })
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
      void exited.then((code) => {
        clearTimeout(timer)
        reject(new Error(REASONS[code ?? -1] ?? "TUN didn't start."))
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

const resolve = async (host: string) => (await lookup(host)).address

/** Linux and macOS. Windows needs the wintun driver, which isn't shipped. */
export const tunnelFor = (): Tunnel | null => {
  if (process.platform === 'linux') return onPath('pkexec') ? { resolve, start } : null
  if (process.platform === 'darwin') return { resolve, start: startMac }
  return null
}
