import { basename, join } from 'node:path'
import { app, dialog, type WebContents } from 'electron'

/** A page's title as a file name: no slashes or characters other systems refuse, and not too long. */
export function pageFileName(title: string, url: string): string {
  const fromTitle = title.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120)
  if (fromTitle) return fromTitle
  try {
    return new URL(url).hostname || 'page'
  } catch {
    return 'page'
  }
}

/** How each choice in the save dialog is written, picked by the file's ending. */
export const saveTypeFor = (path: string): 'HTMLComplete' | 'MHTML' | 'HTMLOnly' => (/\.mhtml?$/i.test(path) ? 'MHTML' : /\.htm$/i.test(path) ? 'HTMLOnly' : 'HTMLComplete')

/**
 * Saves the page as it is now, with what scripts have drawn: as a web page with a folder of its
 * pictures and styles, or as one .mhtml file that holds everything. Returns the file's name, or null
 * if the person cancelled.
 */
export async function savePageAs(contents: WebContents, title: string, folder: string): Promise<string | null> {
  const name = pageFileName(title, contents.getURL())
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: 'Save page',
    defaultPath: join(folder || app.getPath('downloads'), `${name}.html`),
    filters: [
      { name: 'Web page, complete', extensions: ['html'] },
      { name: 'Web page, single file', extensions: ['mhtml'] },
      { name: 'Web page, HTML only', extensions: ['htm'] }
    ]
  })
  if (canceled || !filePath || contents.isDestroyed()) return null
  await contents.savePage(filePath, saveTypeFor(filePath))
  return basename(filePath)
}
