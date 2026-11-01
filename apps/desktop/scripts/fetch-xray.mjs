// Downloads the Xray core that carries VLESS, VMess, Trojan and Shadowsocks connections.
// The version and checksums are pinned, so a changed download fails instead of shipping.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const VERSION = 'v26.10.31'
const BUILDS = {
  linux: { file: 'Xray-linux-64.zip', sha256: 'e4bd9119f50ae7c41658b1abd0679ae06f98bd864a2907ff33f2f2cf7081b214', binary: 'xray' },
  win32: { file: 'Xray-windows-64.zip', sha256: '2e04a9995a6f2ad1b28c0bb25c708ecb2695e43a1c9c7889c4b6ac2b48cf7a6a', binary: 'xray.exe' }
}

const build = BUILDS[process.platform]
if (!build) throw new Error(`No Xray build for ${process.platform}`)
const out = join(dirname(fileURLToPath(import.meta.url)), '../resources/xray')
const target = join(out, build.binary)
const stamp = join(out, `${build.sha256}.ok`)

if (!existsSync(stamp)) {
  const response = await fetch(`https://github.com/XTLS/Xray-core/releases/download/${VERSION}/${build.file}`)
  if (!response.ok) throw new Error(`Download failed: ${response.status}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  const hash = createHash('sha256').update(bytes).digest('hex')
  if (hash !== build.sha256) throw new Error(`Checksum mismatch for ${build.file}: ${hash}`)

  const temporary = mkdtempSync(join(tmpdir(), 'xray-'))
  const archive = join(temporary, build.file)
  writeFileSync(archive, bytes)
  if (process.platform === 'win32') {
    execFileSync('powershell', ['-NoProfile', '-Command', 'Expand-Archive', '-LiteralPath', archive, '-DestinationPath', temporary])
  } else {
    execFileSync('unzip', ['-q', '-o', archive, build.binary, 'LICENSE', '-d', temporary])
  }
  rmSync(out, { recursive: true, force: true })
  mkdirSync(out, { recursive: true })
  copyFileSync(join(temporary, build.binary), target)
  copyFileSync(join(temporary, 'LICENSE'), join(out, 'LICENSE'))
  chmodSync(target, 0o755)
  writeFileSync(stamp, VERSION)
  rmSync(temporary, { recursive: true, force: true })
}
console.log(`Xray ${VERSION} is in ${out}`)
