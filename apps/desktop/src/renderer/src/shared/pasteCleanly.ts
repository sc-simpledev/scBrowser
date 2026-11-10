import type { ClipboardEvent } from 'react'
import { cleanPasted } from '@scbrowser/shared'

/** Tidies pasted text in a message box, typing it in as if by hand so undo still works. */
export function pasteCleanly(event: ClipboardEvent<HTMLTextAreaElement>): void {
  const pasted = event.clipboardData.getData('text/plain')
  const cleaned = cleanPasted(pasted)
  if (cleaned === pasted) return
  event.preventDefault()
  document.execCommand('insertText', false, cleaned)
}
