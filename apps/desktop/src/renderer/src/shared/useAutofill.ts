import { useCallback, useEffect, useLayoutEffect, useMemo, useState, type RefObject } from 'react'
import { inlineAutofill, type Autofill } from '@scbrowser/shared'

/**
 * Inline address completion for a text box, as in Firefox: the rest of the address appears
 * selected after the caret, so typing on replaces it, and Backspace or Delete takes it away
 * until the next typed letter. Pasting, typing mid-text or IME composition never completes.
 */
export function useAutofill(draft: string | null, urls: readonly string[], inputRef: RefObject<HTMLInputElement | null>, enabled: boolean, onDraft: (text: string) => void) {
  const [blocked, setBlocked] = useState(false)
  const autofill: Autofill | null = useMemo(
    () => (enabled && !blocked && draft ? inlineAutofill(draft, urls) : null),
    [enabled, blocked, draft, urls]
  )
  const value = autofill?.text ?? draft

  // React puts the caret at the end when it sets the value; select the completed part instead.
  useLayoutEffect(() => {
    const input = inputRef.current
    if (!autofill || draft === null || !input || document.activeElement !== input) return
    input.setSelectionRange(draft.length, autofill.text.length, 'backward')
  }, [autofill, draft, inputRef])

  // Typing the letter the completion already shows next (the "/" after a host, say) leaves the
  // box's value as it was, so React sends no change. The draft has to catch up all the same, or a
  // later render selects the completion from the old draft again and the next letter replaces it.
  useEffect(() => {
    const input = inputRef.current
    if (!input || !autofill || draft === null) return
    const typedOver = (e: Event) => {
      const native = e as InputEvent
      const caret = input.selectionStart ?? 0
      if (native.inputType !== 'insertText' || native.isComposing || input.selectionEnd !== caret) return
      if (input.value === autofill.text && caret > draft.length) onDraft(input.value.slice(0, caret))
    }
    input.addEventListener('input', typedOver)
    return () => input.removeEventListener('input', typedOver)
  }, [inputRef, autofill, draft, onDraft])

  /** Call from `onChange`, before storing the new text. */
  const noteInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const native = e.nativeEvent as InputEvent
    const atEnd = e.target.selectionStart === e.target.value.length
    setBlocked(native.inputType !== 'insertText' || native.isComposing || !atEnd)
  }, [])

  /** Keeps the completed text as typed, for Right arrow and End. Returns it, or null when there's nothing to keep. */
  const accept = useCallback((): string | null => {
    if (!autofill) return null
    setBlocked(true)
    return autofill.text
  }, [autofill])

  /** Drops the completion until the next letter typed. */
  const dismiss = useCallback(() => setBlocked(true), [])

  return { autofill, value, noteInput, accept, dismiss }
}
