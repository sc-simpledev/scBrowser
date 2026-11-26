import { app, dialog, type BaseWindow, type BrowserWindow } from 'electron'
import { access, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chatFileName, chatMarkdown, noteFileName, type SavedTurn } from '@scbrowser/shared'

/** Asks where, then writes the conversation as Markdown. True once it's saved. */
export async function saveChatMarkdown(window: BaseWindow, turns: SavedTurn[], folder: string): Promise<boolean> {
  if (!turns.some((turn) => turn.content.trim())) return false
  const result = await dialog.showSaveDialog(window as BrowserWindow, {
    title: 'Save chat',
    defaultPath: join(folder || app.getPath('downloads'), chatFileName(turns)),
    filters: [{ name: 'Markdown', extensions: ['md'] }]
  })
  if (result.canceled || !result.filePath) return false
  await writeFile(result.filePath, chatMarkdown(turns, new Date()), 'utf8')
  return true
}

/**
 * An answer as a Markdown note: straight into the notes folder when there is one (never over a
 * note already there), or wherever the person picks. The path, or null if they cancelled.
 */
export async function saveNote(window: BaseWindow, markdown: string, title: string, folder: string): Promise<string | null> {
  const name = noteFileName(title, new Date())
  if (folder) {
    await mkdir(folder, { recursive: true })
    let path = join(folder, name)
    for (let n = 2; await access(path).then(() => true, () => false); n++) path = join(folder, name.replace(/\.md$/, ` (${n}).md`))
    await writeFile(path, markdown, { encoding: 'utf8', flag: 'wx' })
    return path
  }
  const result = await dialog.showSaveDialog(window as BrowserWindow, {
    title: 'Save as a note',
    defaultPath: join(app.getPath('documents'), name),
    filters: [{ name: 'Markdown', extensions: ['md'] }]
  })
  if (result.canceled || !result.filePath) return null
  await writeFile(result.filePath, markdown, 'utf8')
  return result.filePath
}
