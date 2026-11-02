const CHORD = [55, 82.5, 110, 164.8]
const FADE_SECONDS = 4

/** A slow pad made on the spot, so there's no audio file to ship. Off until someone turns it on. */
export function startPad(): () => void {
  const context = new AudioContext()
  const master = context.createGain()
  master.gain.value = 0
  master.gain.linearRampToValueAtTime(0.11, context.currentTime + FADE_SECONDS)
  const filter = context.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.value = 260
  filter.frequency.linearRampToValueAtTime(900, context.currentTime + 18)
  filter.connect(master).connect(context.destination)
  const voices = CHORD.flatMap((frequency) =>
    [-4, 4].map((detune) => {
      const voice = context.createOscillator()
      voice.type = 'sawtooth'
      voice.frequency.value = frequency
      voice.detune.value = detune
      const level = context.createGain()
      level.gain.value = 0.1
      voice.connect(level).connect(filter)
      voice.start()
      return voice
    })
  )
  return () => {
    master.gain.cancelScheduledValues(context.currentTime)
    master.gain.setValueAtTime(master.gain.value, context.currentTime)
    master.gain.linearRampToValueAtTime(0, context.currentTime + 0.6)
    setTimeout(() => {
      voices.forEach((voice) => voice.stop())
      void context.close()
    }, 700)
  }
}
