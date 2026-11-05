import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { accessSync, constants, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { promisify } from 'node:util'
import { app, net } from 'electron'

/**
 * Self-updating for Macs without a Developer ID certificate. electron-updater hands its downloads
 * to Squirrel.Mac, which refuses anything unsigned, so this replaces the app bundle itself: it
 * downloads the zip, checks it, unpacks it beside the profile, and swaps it in once the app has quit.
 */

const run = promisify(execFile)
const APP_ID = 'app.scterra.desktop'
const RELEASE_BASE = 'https://github.com/sc-simpledev/scTerra/releases/download'

export interface UpdateFile {
  url: string
  sha512: string
  size?: number
}

const stagingFolder = () => join(app.getPath('userData'), 'mac-update')
/** Holds the version that couldn't swap itself out, so it stops trying and points at the release instead. */
const failureMarker = () => join(app.getPath('userData'), 'mac-update-failed')

/** One zip is built on each kind of Mac, and the release's update file lists both. */
export const zipForArch = (files: readonly UpdateFile[], arch: string): UpdateFile | undefined =>
  files.find((file) => file.url.endsWith(`-${arch}-mac.zip`))

/** The .app folder a Mac's app runs from: Contents/MacOS/scTerra sits three levels down. */
const runningBundle = () => resolve(process.execPath, '../../..')

/**
 * Whether this copy can be swapped out. An app opened from the disk image, or one macOS is
 * running from a hidden read-only copy because it was never moved out of Downloads, can't be.
 */
export function canReplaceApp(path = runningBundle(), version = app.getVersion()): boolean {
  if (!path.endsWith('.app') || path.startsWith('/Volumes/') || path.includes('/AppTranslocation/')) return false
  try {
    if (readFileSync(failureMarker(), 'utf8').trim() === version) return false
  } catch {
    // No failure on record, which is the usual case.
  }
  try {
    accessSync(path, constants.W_OK)
    accessSync(dirname(path), constants.W_OK)
    return true
  } catch {
    return false
  }
}

async function download(url: string, file: UpdateFile, target: string, onPercent: (percent: number) => void): Promise<void> {
  const response = await net.fetch(url)
  if (!response.ok || !response.body) throw new Error(`Download failed with status ${response.status}`)
  const total = file.size ?? Number(response.headers.get('content-length'))
  const hash = createHash('sha512')
  let received = 0
  let reported = -1
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      hash.update(chunk)
      received += chunk.length
      const percent = total > 0 ? Math.min(100, Math.floor((received / total) * 100)) : 0
      if (percent !== reported) onPercent((reported = percent))
      done(null, chunk)
    }
  })
  await pipeline(Readable.fromWeb(response.body as never), counter, createWriteStream(target))
  if (hash.digest('base64') !== file.sha512) throw new Error('The update failed its sha512 checksum')
}

/** Unpacks the zip and makes sure what came out is this app, at this version, and undamaged. */
async function unpack(zip: string, folder: string, version: string): Promise<string> {
  const into = join(folder, 'unpacked')
  // ditto, as it keeps the symlinks and signature that a framework bundle depends on.
  await run('/usr/bin/ditto', ['-x', '-k', zip, into])
  const bundles = readdirSync(into).filter((name) => name.endsWith('.app'))
  if (bundles.length !== 1) throw new Error('The update has no single app in it')
  const bundle = join(into, bundles[0]!)
  const plist = join(bundle, 'Contents/Info.plist')
  const read = async (key: string) => (await run('/usr/bin/plutil', ['-extract', key, 'raw', '-o', '-', plist])).stdout.trim()
  if ((await read('CFBundleIdentifier')) !== APP_ID) throw new Error('The update is a different app')
  if ((await read('CFBundleShortVersionString')) !== version) throw new Error('The update is a different version')
  await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle])
  // It came with a checksum from the release, so it doesn't need Gatekeeper's first-run stop.
  await run('/usr/bin/xattr', ['-dr', 'com.apple.quarantine', bundle]).catch(() => undefined)
  return bundle
}

/** Downloads and checks a version, and returns the unpacked app ready to swap in. */
export async function stageUpdate(version: string, file: UpdateFile, onPercent: (percent: number) => void, feed?: string): Promise<string> {
  const base = feed ? `${feed.replace(/\/$/, '')}/` : `${RELEASE_BASE}/v${version}/`
  const url = new URL(file.url, base)
  if (url.protocol !== 'https:' && !feed) throw new Error('Updates only come over https')
  const folder = stagingFolder()
  rmSync(folder, { recursive: true, force: true })
  mkdirSync(folder, { recursive: true })
  const zip = join(folder, basename(url.pathname))
  await download(url.toString(), file, zip, onPercent)
  const bundle = await unpack(zip, folder, version)
  rmSync(zip, { force: true })
  return bundle
}

/**
 * Runs once the app has gone. The old bundle is only deleted after the new one is in place, and comes
 * back if that fails. All paths arrive as arguments, as a folder's name can hold any character.
 */
export const SWAP_SCRIPT = `
pid=$1 current=$2 next=$3 reopen=$4 marker=$5 version=$6
waited=0
while kill -0 "$pid" 2>/dev/null; do
  waited=$((waited + 1))
  [ "$waited" -gt 300 ] && exit 1
  sleep 0.2
done
old="$current.replaced-$$"
if mv "$current" "$old"; then
  if mv "$next" "$current"; then
    rm -rf "$old" "$(dirname "$(dirname "$next")")"
    rm -f "$marker"
  else
    mv "$old" "$current"
    printf %s "$version" > "$marker"
  fi
else
  printf %s "$version" > "$marker"
fi
if [ "$reopen" = 1 ]; then open "$current"; fi
`

/** Leaves the swap running. The caller quits the app, which is what it waits for. */
export function swapOnExit(staged: string, reopen: boolean): void {
  if (!existsSync(staged)) return
  spawn('/bin/sh', ['-c', SWAP_SCRIPT, 'scterra-update', String(process.pid), runningBundle(), staged, reopen ? '1' : '0', failureMarker(), app.getVersion()], {
    detached: true,
    stdio: 'ignore'
  }).unref()
}
