import { readFile, stat, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import { imageType, MAX_BACKGROUND_BYTES } from '@scbrowser/shared'

/** The new tab picture lives only on this computer, in the profile's folder. */
const path = () => join(app.getPath('userData'), 'newtab-background')

export const removeBackground = () => unlink(path()).catch(() => undefined)

/** Copies a chosen picture into the profile. Throws if it's too big or not an image. */
export async function saveBackground(source: string): Promise<void> {
  if ((await stat(source)).size > MAX_BACKGROUND_BYTES) throw new Error('That picture is over 25 MB.')
  const bytes = await readFile(source)
  if (!imageType(bytes)) throw new Error('Use a PNG, JPEG, WebP, GIF or AVIF picture.')
  await writeFile(path(), bytes)
}

/** Handed over only through the internal bridge, so no website can ever request it. */
export async function readBackground(): Promise<{ bytes: Uint8Array; type: string } | null> {
  const bytes = await readFile(path()).catch(() => null)
  const type = bytes && imageType(bytes)
  return type ? { bytes, type } : null
}
