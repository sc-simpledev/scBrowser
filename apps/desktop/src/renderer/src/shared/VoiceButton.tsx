import { Loader2, Mic, Square } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { cx, IconButton } from '@scbrowser/ui'

/** Recordings stop by themselves after this long. */
const MAX_SECONDS = 180
const RATE = 16_000

/** 16-bit mono WAV, which every speech service takes. */
export function wavFrom(samples: Float32Array, rate = RATE): Uint8Array {
  const out = new DataView(new ArrayBuffer(44 + samples.length * 2))
  const text = (at: number, value: string) => [...value].forEach((char, i) => out.setUint8(at + i, char.charCodeAt(0)))
  text(0, 'RIFF')
  out.setUint32(4, 36 + samples.length * 2, true)
  text(8, 'WAVE')
  text(12, 'fmt ')
  out.setUint32(16, 16, true)
  out.setUint16(20, 1, true)
  out.setUint16(22, 1, true)
  out.setUint32(24, rate, true)
  out.setUint32(28, rate * 2, true)
  out.setUint16(32, 2, true)
  out.setUint16(34, 16, true)
  text(36, 'data')
  out.setUint32(40, samples.length * 2, true)
  samples.forEach((sample, i) => out.setInt16(44 + i * 2, Math.max(-1, Math.min(1, sample)) * 0x7fff, true))
  return new Uint8Array(out.buffer)
}

const base64 = (bytes: Uint8Array) => {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

/** What was recorded, as 16 kHz mono WAV in base64. */
async function toWav(blob: Blob): Promise<string> {
  const context = new AudioContext({ sampleRate: RATE })
  try {
    const audio = await context.decodeAudioData(await blob.arrayBuffer())
    const mono = new Float32Array(audio.length)
    for (let channel = 0; channel < audio.numberOfChannels; channel++) {
      const data = audio.getChannelData(channel)
      for (let i = 0; i < data.length; i++) mono[i]! += data[i]! / audio.numberOfChannels
    }
    return base64(wavFrom(mono))
  } finally {
    void context.close()
  }
}

/**
 * The assistant's microphone: press to record, press again to stop, and the words land in the box.
 * The recording goes only to the AI service the person set up (named in the tooltip), and nothing
 * is recorded until the button is pressed.
 */
export function VoiceButton({ onText, onError }: { onText: (text: string) => void; onError: (message: string) => void }) {
  const [voice, setVoice] = useState<{ available: boolean; service: string | null } | null>(null)
  const [state, setState] = useState<'idle' | 'recording' | 'working'>('idle')
  const recorder = useRef<MediaRecorder | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    void window.scb.invoke('ai:voice').then(setVoice, () => setVoice(null))
  }, [])
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
      recorder.current?.stream.getTracks().forEach((track) => track.stop())
    },
    []
  )
  if (!voice) return null
  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
      const chunks: Blob[] = []
      const made = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' })
      made.ondataavailable = (event) => event.data.size > 0 && chunks.push(event.data)
      made.onstop = () => {
        stream.getTracks().forEach((track) => track.stop())
        setState('working')
        void toWav(new Blob(chunks, { type: 'audio/webm' }))
          .then((wav) => window.scb.invoke('ai:transcribe', wav))
          .then(
            (text) => {
              if (text) onText(text)
              else onError('Nothing was heard. Check the microphone, and try again.')
            },
            (error: Error) => onError(error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
          )
          .finally(() => setState('idle'))
      }
      recorder.current = made
      made.start()
      setState('recording')
      timer.current = setTimeout(() => made.state === 'recording' && made.stop(), MAX_SECONDS * 1000)
    } catch {
      onError('The microphone couldn’t be used. Check that one is connected and allowed for scTerra.')
    }
  }
  const stop = () => {
    if (timer.current) clearTimeout(timer.current)
    if (recorder.current?.state === 'recording') recorder.current.stop()
  }
  const label = !voice.available
    ? 'Speak instead of typing: add an OpenAI, Gemini or Groq key, or a local Whisper server, in AI settings'
    : state === 'recording'
      ? 'Stop and turn it into text'
      : state === 'working'
        ? 'Turning it into text…'
        : `Speak instead of typing. ${voice.service} hears the recording.`
  return (
    <IconButton
      size="sm"
      label={label}
      aria-pressed={state === 'recording'}
      disabled={!voice.available || state === 'working'}
      className={cx(state === 'recording' ? 'text-danger' : 'text-text-faint')}
      onClick={() => (state === 'recording' ? stop() : void start())}
    >
      {state === 'working' ? <Loader2 size={13} strokeWidth={1.75} className="animate-spin" /> : state === 'recording' ? <Square size={11} strokeWidth={2.25} /> : <Mic size={13} strokeWidth={1.75} />}
    </IconButton>
  )
}
