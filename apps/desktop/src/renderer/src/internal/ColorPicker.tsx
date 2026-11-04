import { useRef, useState } from 'react'
import { cx, Input } from '@scbrowser/ui'

interface Hsv {
  h: number
  s: number
  v: number
}

const HEX = /^#[0-9a-f]{6}$/i
const PRESETS = ['#111827', '#1f2937', '#334155', '#0f3d3e', '#3b1f47', '#7c2d12', '#e5e7eb', '#f5efe6']

export function hexToHsv(hex: string): Hsv {
  const [r, g, b] = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255) as [number, number, number]
  const max = Math.max(r, g, b)
  const range = max - Math.min(r, g, b)
  const h = range === 0 ? 0 : max === r ? ((g - b) / range + 6) % 6 : max === g ? (b - r) / range + 2 : (r - g) / range + 4
  return { h: h * 60, s: max === 0 ? 0 : range / max, v: max }
}

export function hsvToHex({ h, s, v }: Hsv): string {
  const channel = (n: number) => {
    const k = (n + h / 60) % 6
    return Math.round((v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255)
  }
  return `#${[5, 3, 1].map((n) => channel(n).toString(16).padStart(2, '0')).join('')}`
}

/**
 * Drawn in the page rather than using the system's colour popup, which Chromium places itself
 * and can push off the edge of the window. The colours here are the picker's content, not the interface's.
 */
export function ColorPicker({ value, onChange }: { value: string; onChange: (color: string) => void }) {
  // The hue is kept separately, as black and white have none and would otherwise lose it.
  const [hsv, setHsv] = useState(() => hexToHsv(value))
  const [typed, setTyped] = useState<string | null>(null)
  const square = useRef<HTMLDivElement>(null)
  const set = (next: Hsv) => {
    setHsv(next)
    setTyped(null)
    onChange(hsvToHex(next))
  }
  const pick = (x: number, y: number) => {
    const box = square.current!.getBoundingClientRect()
    set({ ...hsv, s: Math.min(1, Math.max(0, (x - box.left) / box.width)), v: Math.min(1, Math.max(0, 1 - (y - box.top) / box.height)) })
  }
  return (
    <div role="group" aria-label="Colour picker" className="flex flex-col gap-2 rounded-md border border-border p-2">
      <div
        ref={square}
        role="slider"
        aria-label="Saturation and brightness"
        aria-valuenow={Math.round(hsv.s * 100)}
        aria-valuetext={value}
        tabIndex={0}
        className="relative h-32 w-full cursor-crosshair touch-none rounded-sm"
        style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent), hsl(${hsv.h} 100% 50%)` }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          pick(e.clientX, e.clientY)
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) pick(e.clientX, e.clientY)
        }}
        onKeyDown={(e) => {
          const step = { ArrowLeft: [-0.02, 0], ArrowRight: [0.02, 0], ArrowUp: [0, 0.02], ArrowDown: [0, -0.02] }[e.key]
          if (!step) return
          e.preventDefault()
          set({ ...hsv, s: Math.min(1, Math.max(0, hsv.s + step[0]!)), v: Math.min(1, Math.max(0, hsv.v + step[1]!)) })
        }}
      >
        <span aria-hidden className="absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-1" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: value }} />
      </div>
      <input
        type="range"
        aria-label="Hue"
        min={0}
        max={360}
        value={Math.round(hsv.h)}
        onChange={(e) => set({ ...hsv, h: Number(e.target.value) })}
        className="sc-hue-slider h-3 w-full cursor-pointer appearance-none rounded-full"
      />
      <div className="flex items-center gap-2">
        <Input
          aria-label="Colour code"
          spellCheck={false}
          className="w-24 font-mono text-xs"
          value={typed ?? value}
          onChange={(e) => {
            const text = e.target.value.trim()
            setTyped(text)
            if (!HEX.test(text)) return
            setHsv(hexToHsv(text))
            onChange(text.toLowerCase())
          }}
          onBlur={() => setTyped(null)}
        />
        <div className="flex min-w-0 flex-1 flex-wrap justify-end gap-1">
          {PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              aria-label={`Use ${preset}`}
              className={cx('size-5 rounded-sm border', preset === value ? 'border-text' : 'border-border')}
              style={{ background: preset }}
              onClick={() => {
                setHsv(hexToHsv(preset))
                setTyped(null)
                onChange(preset)
              }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
