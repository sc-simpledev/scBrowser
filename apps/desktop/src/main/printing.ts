import { writeFile } from 'node:fs/promises'
import { dialog, type BaseWindow, type WebContents } from 'electron'
import { parsePageRanges, type PrintChoice, type PrinterChoice } from '@scbrowser/shared'

export async function listPrinters(contents: WebContents): Promise<PrinterChoice[]> {
  const printers = await contents.getPrintersAsync().catch(() => [])
  return printers.map((printer) => ({
    name: printer.name,
    displayName: printer.displayName || printer.name,
    isDefault: (printer as { isDefault?: boolean }).isDefault === true || (printer.options as Record<string, string> | undefined)?.['printer-is-default'] === 'true'
  }))
}

const safeName = (title: string) => (title.replace(/\.pdf$/i, '').replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Document').slice(0, 120)

/**
 * Prints what the dialog chose without showing the system's own box, or saves it as a PDF.
 * With no choice it falls back to the system dialog. Returns why it failed, or null.
 */
export async function printWith(contents: WebContents, window: BaseWindow, pageCount: number, choice?: PrintChoice): Promise<string | null> {
  if (!choice) {
    contents.print()
    return null
  }
  const ranges = parsePageRanges(choice.pages, Math.max(1, pageCount))
  if (!ranges) return `Pages must be numbers from 1 to ${pageCount}, like 1-3, 5.`
  if (choice.destination === 'pdf') {
    const data = await contents.printToPDF({
      landscape: choice.landscape,
      printBackground: true,
      pageRanges: choice.pages.trim() ? ranges.map(({ from, to }) => (from === to ? `${from}` : `${from}-${to}`)).join(',') : undefined
    })
    const result = await dialog.showSaveDialog(window as Electron.BrowserWindow, { defaultPath: `${safeName(contents.getTitle())}.pdf`, filters: [{ name: 'PDF', extensions: ['pdf'] }] })
    if (result.canceled || !result.filePath) return null
    await writeFile(result.filePath, data)
    return null
  }
  const printers = await listPrinters(contents)
  if (!printers.some((printer) => printer.name === choice.destination)) return 'That printer isn’t available any more.'
  return new Promise((resolve) => {
    contents.print(
      {
        silent: true,
        deviceName: choice.destination,
        copies: choice.copies,
        landscape: choice.landscape,
        color: choice.color,
        printBackground: true,
        duplexMode: choice.twoSided ? (choice.landscape ? 'shortEdge' : 'longEdge') : 'simplex',
        ...(choice.pages.trim() ? { pageRanges: ranges.map(({ from, to }) => ({ from: from - 1, to: to - 1 })) } : {})
      },
      (success, reason) => resolve(success || reason === 'cancelled' ? null : `It didn’t print: ${reason || 'the printer refused it'}.`)
    )
  })
}
