import type { ClipboardEvent, DragEvent } from 'react'

/** Vision models read up to about this many pixels on the long side. */
const MAX_SIDE = 1568

/** A picture file as a JPEG data address, sized for a model. Null if it isn't a picture that can be read. */
export async function pictureData(file: File): Promise<string | null> {
  if (!/^image\/(png|jpeg|webp|gif|bmp|avif)$/.test(file.type) || file.size > 30_000_000) return null
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const context = canvas.getContext('2d')
    if (!context) return null
    // JPEG has no transparency, so see-through parts become white rather than black.
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()
    return canvas.toDataURL('image/jpeg', 0.85)
  } catch {
    return null
  }
}

/** The first picture in a paste or drop, if there is one. */
export function pictureFile(event: ClipboardEvent | DragEvent): File | null {
  const data = 'clipboardData' in event ? event.clipboardData : event.dataTransfer
  return [...(data?.files ?? [])].find((file) => file.type.startsWith('image/')) ?? null
}
