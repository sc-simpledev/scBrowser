/**
 * A QR code for a page's address, made here with no network, to take a page to a phone. Byte mode
 * only (addresses are short), at error correction level M (15% damage), or L when it needs more
 * room, versions 1 to 40, with the mask chosen by the standard's penalty rules (ISO/IEC 18004).
 */

export type QrLevel = 'L' | 'M'

/** Error correction codewords per block, by version (index 0 unused). */
const ECC_PER_BLOCK: Record<QrLevel, number[]> = {
  L: [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  M: [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28]
}

/** Error correction blocks, by version (index 0 unused). */
const BLOCKS: Record<QrLevel, number[]> = {
  L: [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  M: [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49]
}

/** The two bits the format information carries for each level. */
const LEVEL_BITS: Record<QrLevel, number> = { L: 1, M: 0 }

/** Modules that hold data and error correction, after the fixed patterns. */
export function rawDataModules(version: number): number {
  let result = (16 * version + 128) * version + 64
  if (version >= 2) {
    const aligns = Math.floor(version / 7) + 2
    result -= (25 * aligns - 10) * aligns - 55
    if (version >= 7) result -= 36
  }
  return result
}

export function dataCodewords(version: number, level: QrLevel): number {
  return Math.floor(rawDataModules(version) / 8) - ECC_PER_BLOCK[level][version]! * BLOCKS[level][version]!
}

/** Multiplication in GF(2^8) modulo x^8 + x^4 + x^3 + x^2 + 1. */
function gfMultiply(x: number, y: number): number {
  let z = 0
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d)
    z ^= ((y >>> i) & 1) * x
  }
  return z
}

/** The Reed–Solomon generator polynomial of a degree, highest coefficient (always 1) left out. */
export function rsDivisor(degree: number): number[] {
  const result = new Array<number>(degree).fill(0)
  result[degree - 1] = 1
  let root = 1
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = gfMultiply(result[j]!, root)
      if (j + 1 < result.length) result[j]! ^= result[j + 1]!
    }
    root = gfMultiply(root, 0x02)
  }
  return result
}

export function rsRemainder(data: number[], divisor: number[]): number[] {
  const result = new Array<number>(divisor.length).fill(0)
  for (const byte of data) {
    const factor = byte ^ result.shift()!
    result.push(0)
    divisor.forEach((coefficient, i) => (result[i]! ^= gfMultiply(coefficient, factor)))
  }
  return result
}

/** The 15 format bits for a level and mask, BCH-coded and masked as the standard says. */
export function formatBits(level: QrLevel, mask: number): number {
  const data = (LEVEL_BITS[level] << 3) | mask
  let rem = data
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537)
  return ((data << 10) | rem) ^ 0x5412
}

/** The 18 version bits, from version 7 on. */
export function versionBits(version: number): number {
  let rem = version
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25)
  return (version << 12) | rem
}

function alignmentPositions(version: number, size: number): number[] {
  if (version === 1) return []
  const count = Math.floor(version / 7) + 2
  const step = Math.floor((version * 8 + count * 3 + 5) / (count * 4 - 4)) * 2
  const result = [6]
  for (let position = size - 7; result.length < count; position -= step) result.splice(1, 0, position)
  return result
}

const bit = (value: number, index: number) => ((value >>> index) & 1) !== 0

/** A QR code: `modules[y][x]`, true for dark, without the quiet zone around it. */
export interface QrCode {
  version: number
  level: QrLevel
  mask: number
  size: number
  modules: boolean[][]
}

/** Encodes text as UTF-8 in byte mode. Null when it's too long for any version. */
export function encodeQr(text: string, preferred: QrLevel = 'M'): QrCode | null {
  const bytes = [...new TextEncoder().encode(text)]
  for (const level of preferred === 'M' ? (['M', 'L'] as const) : (['L'] as const)) {
    for (let version = 1; version <= 40; version++) {
      const countBits = version < 10 ? 8 : 16
      const capacity = dataCodewords(version, level) * 8
      if (4 + countBits + bytes.length * 8 > capacity) continue
      return build(bytes, version, level, countBits, capacity)
    }
  }
  return null
}

function build(bytes: number[], version: number, level: QrLevel, countBits: number, capacity: number): QrCode {
  // The data: mode, length, bytes, then a terminator, padding to a byte, and the pad bytes.
  const bits: number[] = []
  const push = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1)
  }
  push(0b0100, 4)
  push(bytes.length, countBits)
  for (const byte of bytes) push(byte, 8)
  push(0, Math.min(4, capacity - bits.length))
  push(0, (8 - (bits.length % 8)) % 8)
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) push(pad, 8)
  const data: number[] = []
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((byte, one) => (byte << 1) | one, 0))

  // Error correction per block, then the blocks interleaved.
  const blockCount = BLOCKS[level][version]!
  const eccLength = ECC_PER_BLOCK[level][version]!
  const raw = Math.floor(rawDataModules(version) / 8)
  const shortBlocks = blockCount - (raw % blockCount)
  const shortLength = Math.floor(raw / blockCount)
  const divisor = rsDivisor(eccLength)
  const blocks: number[][] = []
  for (let i = 0, k = 0; i < blockCount; i++) {
    const part = data.slice(k, k + shortLength - eccLength + (i < shortBlocks ? 0 : 1))
    k += part.length
    const ecc = rsRemainder(part, divisor)
    if (i < shortBlocks) part.push(0)
    blocks.push([...part, ...ecc])
  }
  const codewords: number[] = []
  for (let i = 0; i < blocks[0]!.length; i++) blocks.forEach((block, j) => (i !== shortLength - eccLength || j >= shortBlocks) && codewords.push(block[i]!))

  // The fixed patterns, then the codewords zigzagging up and down in pairs of columns from the right.
  const size = version * 4 + 17
  const modules = Array.from({ length: size }, () => new Array<boolean>(size).fill(false))
  const fixed = Array.from({ length: size }, () => new Array<boolean>(size).fill(false))
  const set = (x: number, y: number, dark: boolean) => {
    modules[y]![x] = dark
    fixed[y]![x] = true
  }
  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0)
    set(i, 6, i % 2 === 0)
  }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]] as const) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx
        const y = cy + dy
        const distance = Math.max(Math.abs(dx), Math.abs(dy))
        if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, distance !== 2 && distance !== 4)
      }
    }
  }
  const aligns = alignmentPositions(version, size)
  aligns.forEach((ay, i) =>
    aligns.forEach((ax, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === aligns.length - 1) || (i === aligns.length - 1 && j === 0)) return
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
    })
  )
  const drawFormat = (mask: number) => {
    const format = formatBits(level, mask)
    for (let i = 0; i <= 5; i++) set(8, i, bit(format, i))
    set(8, 7, bit(format, 6))
    set(8, 8, bit(format, 7))
    set(7, 8, bit(format, 8))
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(format, i))
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(format, i))
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(format, i))
    set(8, size - 8, true)
  }
  drawFormat(0)
  if (version >= 7) {
    const bitsOfVersion = versionBits(version)
    for (let i = 0; i < 18; i++) {
      const a = size - 11 + (i % 3)
      const b = Math.floor(i / 3)
      set(a, b, bit(bitsOfVersion, i))
      set(b, a, bit(bitsOfVersion, i))
    }
  }
  let index = 0
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    for (let vertical = 0; vertical < size; vertical++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j
        const upward = ((right + 1) & 2) === 0
        const y = upward ? size - 1 - vertical : vertical
        if (!fixed[y]![x] && index < codewords.length * 8) {
          modules[y]![x] = bit(codewords[index >>> 3]!, 7 - (index & 7))
          index++
        }
      }
    }
  }

  // Each mask tried, the one with the lowest penalty kept.
  const applyMask = (mask: number) => {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (fixed[y]![x]) continue
        const flip = [(x + y) % 2 === 0, y % 2 === 0, x % 3 === 0, (x + y) % 3 === 0, (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, ((x * y) % 2) + ((x * y) % 3) === 0, (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (((x + y) % 2) + ((x * y) % 3)) % 2 === 0][mask]!
        if (flip) modules[y]![x] = !modules[y]![x]
      }
    }
  }
  let best = 0
  let lowest = Infinity
  for (let mask = 0; mask < 8; mask++) {
    applyMask(mask)
    drawFormat(mask)
    const score = penalty(modules)
    if (score < lowest) {
      lowest = score
      best = mask
    }
    applyMask(mask)
  }
  applyMask(best)
  drawFormat(best)
  return { version, level, mask: best, size, modules }
}

/** The standard's four penalty rules: long runs, 2×2 blocks, finder-like patterns, and dark/light balance. */
export function penalty(modules: boolean[][]): number {
  const size = modules.length
  let score = 0
  const line = (get: (i: number) => boolean) => {
    let run = 1
    for (let i = 1; i <= size; i++) {
      if (i < size && get(i) === get(i - 1)) run++
      else {
        if (run >= 5) score += run - 2
        run = 1
      }
    }
    // 1:1:3:1:1 dark-light-dark-light-dark with four light on one side.
    const finder = [true, false, true, true, true, false, true]
    for (let i = 0; i + 7 <= size; i++) {
      if (!finder.every((dark, k) => get(i + k) === dark)) continue
      const before = i >= 4 && [1, 2, 3, 4].every((k) => !get(i - k))
      const after = i + 11 <= size && [7, 8, 9, 10].every((k) => !get(i + k))
      if (before || after) score += 40
    }
  }
  for (let y = 0; y < size; y++) line((x) => modules[y]![x]!)
  for (let x = 0; x < size; x++) line((y) => modules[y]![x]!)
  for (let y = 0; y + 1 < size; y++) {
    for (let x = 0; x + 1 < size; x++) {
      const dark = modules[y]![x]
      if (dark === modules[y]![x + 1] && dark === modules[y + 1]![x] && dark === modules[y + 1]![x + 1]) score += 3
    }
  }
  const dark = modules.reduce((sum, row) => sum + row.filter(Boolean).length, 0)
  const total = size * size
  score += Math.floor(Math.abs(dark * 20 - total * 10) / total) * 10
  return score
}

/** The code as one SVG path in module units, with a quiet zone of `margin` modules around it. */
export function qrPath(code: QrCode, margin = 4): string {
  const parts: string[] = []
  code.modules.forEach((row, y) => {
    let x = 0
    while (x < code.size) {
      if (!row[x]) {
        x++
        continue
      }
      let end = x
      while (end < code.size && row[end]) end++
      parts.push(`M${x + margin} ${y + margin}h${end - x}v1h${x - end}z`)
      x = end
    }
  })
  return parts.join('')
}
