import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { accessSync, constants } from 'node:fs'
import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises'
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
  config: (device: string, mark: number) => unknown
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
  child.stdin.write(`${Buffer.from(JSON.stringify(config(DEVICE, MARK))).toString('base64')}\n`)

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

/** Only Linux for now: Windows needs a driver we don't ship, and Macs a different set of routes. */
export const tunnelFor = (): Tunnel | null =>
  process.platform === 'linux' && onPath('pkexec') ? { resolve: async (host) => (await lookup(host)).address, start } : null
