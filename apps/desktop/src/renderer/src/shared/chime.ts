import type { StudySound } from '@scbrowser/shared'

/** Notes as [frequency in Hz, start in seconds, length in seconds], for each sound. */
const NOTES: Record<Exclude<StudySound, 'none'>, { wave: OscillatorType; notes: [number, number, number][] }> = {
  // Two rising notes, a fifth apart.
  chime: { wave: 'sine', notes: [[784, 0, 0.9], [1175, 0.18, 1.1]] },
  // One struck note with an overtone, ringing out.
  bell: { wave: 'triangle', notes: [[659, 0, 1.6], [1318, 0, 0.9], [1976, 0, 0.5]] },
  // A low, quiet two-note fall.
  soft: { wave: 'sine', notes: [[523, 0, 0.7], [392, 0.22, 0.9]] }
}

let context: AudioContext | null = null

/**
 * The focus timer's end-of-round sound, made in WebAudio so there are no files to ship. `volume` is
 * 0 to 100. Does nothing for 'none' or where audio isn't allowed.
 */
export function playChime(sound: StudySound, volume: number): void {
  if (sound === 'none' || volume <= 0) return
  try {
    context ??= new AudioContext()
    void context.resume()
    const { wave, notes } = NOTES[sound]
    const peak = Math.min(1, volume / 100) * 0.25
    const start = context.currentTime + 0.02
    for (const [frequency, at, length] of notes) {
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      oscillator.type = wave
      oscillator.frequency.value = frequency
      gain.gain.setValueAtTime(0.0001, start + at)
      gain.gain.exponentialRampToValueAtTime(peak / notes.length + 0.0001, start + at + 0.015)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + at + length)
      oscillator.connect(gain).connect(context.destination)
      oscillator.start(start + at)
      oscillator.stop(start + at + length + 0.05)
    }
  } catch {
    // No audio here: the toast still says the round is over.
  }
}
