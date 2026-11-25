import { app, dialog, type BaseWindow, type BrowserWindow } from 'electron'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chatFileName, chatMarkdown, type SavedTurn } from '@scbrowser/shared'

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
