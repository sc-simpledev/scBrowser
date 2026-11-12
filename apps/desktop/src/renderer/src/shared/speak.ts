import { useCallback, useEffect, useState } from 'react'

/** What's being said now, so only one thing speaks at a time and its button knows. */
let current: string | null = null
const listeners = new Set<() => void>()
const tell = () => listeners.forEach((listener) => listener())

async function voicesReady(): Promise<boolean> {
  const speech = window.speechSynthesis
  if (speech.getVoices().length > 0) return true
  await new Promise<void>((done) => {
    speech.addEventListener('voiceschanged', () => done(), { once: true })
    setTimeout(done, 800)
  })
  return speech.getVoices().length > 0
}

/**
 * Says text aloud with the computer's own voices, or stops if it's already saying it. Long text
 * goes in pieces, as Chromium stops long utterances partway.
 */
export function useSpeak(key: string): { speaking: boolean; problem: string | null; toggle: (text: string) => void } {
  const [, redraw] = useState(0)
  const [problem, setProblem] = useState<string | null>(null)
  useEffect(() => {
    const listener = () => redraw((n) => n + 1)
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
      if (current === key) {
        window.speechSynthesis.cancel()
        current = null
      }
    }
  }, [key])
  const toggle = useCallback(
    (text: string) => {
      const speech = window.speechSynthesis
      const wasThis = current === key
      speech.cancel()
      current = null
      tell()
      if (wasThis) return
      void voicesReady().then((ready) => {
        if (!ready) return setProblem('No text-to-speech voices are installed on this computer.')
        setProblem(null)
        const pieces = (text.match(/[^.!?\n]{1,220}[.!?\n]*|[.!?\n]+/g) ?? []).map((piece) => piece.trim()).filter(Boolean)
        if (pieces.length === 0) return
        current = key
        pieces.forEach((piece, index) => {
          const utterance = new SpeechSynthesisUtterance(piece)
          if (index === pieces.length - 1) {
            const finish = () => {
              if (current !== key) return
              current = null
              tell()
            }
            utterance.onend = finish
            utterance.onerror = finish
          }
          speech.speak(utterance)
        })
        tell()
      })
    },
    [key]
  )
  return { speaking: current === key, problem, toggle }
}
