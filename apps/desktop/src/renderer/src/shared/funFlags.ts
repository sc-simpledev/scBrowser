import './funFlags.css'

/** Fixed points through the day: the accent drifts between them, from indigo nights to a warm dusk. */
const DAY = [
  [0, 265],
  [6, 320],
  [8, 30],
  [12, 200],
  [17, 60],
  [20, 300],
  [24, 265]
] as const
const DAY_REFRESH_MS = 600_000

export function hueAt(hour: number): number {
  const end = DAY.findIndex(([at]) => at > hour)
  const [fromHour, fromHue] = DAY[end - 1]!
  const [toHour, toHue] = DAY[end]!
  return Math.round(fromHue + ((toHue - fromHue) * (hour - fromHour)) / (toHour - fromHour))
}

export const hasFlag = (id: string) => document.documentElement.hasAttribute(`data-flag-${id}`)

function followTheDay() {
  const paint = () => {
    const now = new Date()
    const root = document.documentElement.style
    root.setProperty('--sc-hue', String(hueAt(now.getHours() + now.getMinutes() / 60)))
    root.setProperty('--sc-chroma', '0.15')
  }
  paint()
  setInterval(paint, DAY_REFRESH_MS)
}

/** Each flag is a mark on the page's root element, which the styles and a few features look for. */
export function applyFunFlags(flags: string[]): void {
  for (const flag of flags) document.documentElement.setAttribute(`data-flag-${flag}`, '')
  if (flags.includes('day-cycle')) followTheDay()
}

let sound: AudioContext | undefined

/** A tiny burst of filtered noise, made on the spot like the intro's sound. */
export function clack(): void {
  sound ??= new AudioContext()
  const length = Math.floor(sound.sampleRate * 0.025)
  const buffer = sound.createBuffer(1, length, sound.sampleRate)
  const samples = buffer.getChannelData(0)
  for (let i = 0; i < length; i++) samples[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 3
  const source = sound.createBufferSource()
  source.buffer = buffer
  source.playbackRate.value = 0.8 + Math.random() * 0.5
  const filter = sound.createBiquadFilter()
  filter.type = 'bandpass'
  filter.frequency.value = 2400
  const level = sound.createGain()
  level.gain.value = 0.22
  source.connect(filter).connect(level).connect(sound.destination)
  source.start()
}
