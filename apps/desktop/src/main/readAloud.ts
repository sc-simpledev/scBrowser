export const READ_ALOUD_WORLD = 1006

/** Speaks the selection or the page's main text, or stops if it's already speaking. Long text goes in pieces, as Chromium stops long utterances partway. */
export const READ_ALOUD = `(async () => {
  const speech = window.speechSynthesis
  if (speech.speaking) { speech.cancel(); return 'stopped' }
  if (speech.getVoices().length === 0) await new Promise((done) => { speech.addEventListener('voiceschanged', done, { once: true }); setTimeout(done, 800) })
  if (speech.getVoices().length === 0) return 'no-voices'
  const picked = String(getSelection() || '').trim()
  const root = document.querySelector('article') || document.querySelector('main') || document.body
  const text = (picked || root.innerText || '').slice(0, 60000)
  const pieces = text.match(/[^.!?\\n]{1,220}[.!?\\n]*|[.!?\\n]+/g) || []
  for (const piece of pieces) if (piece.trim()) speech.speak(new SpeechSynthesisUtterance(piece.trim()))
  return 'speaking'
})()`
