import { BrowserWindow, dialog, type BaseWindow } from 'electron'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { REPORT_FORMATS, toReport, type ReportFormat } from '@scbrowser/shared'
import { reportDocx } from './reportDocx'

const MAX_SIZE = 8_000_000

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

/** Lays the report out in a hidden window with scripts off. Its page already blocks scripts and network requests. */
async function renderPdf(html: string, title: string): Promise<Buffer> {
  const folder = await mkdtemp(join(tmpdir(), 'scterra-report-'))
  const printer = new BrowserWindow({ show: false, webPreferences: { sandbox: true, javascript: false, partition: 'scterra-report-export' } })
  try {
    const page = join(folder, 'report.html')
    await writeFile(page, html, { mode: 0o600 })
    await printer.loadFile(page)
    const small = 'font: 8px sans-serif; color: #8a8a8a; width: 100%; padding: 0 16mm; display: flex; justify-content: space-between;'
    return await printer.webContents.printToPDF({
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: `<div style="${small}"><span>${escapeHtml(title)}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
      margins: { top: 0.7, bottom: 0.7, left: 0.75, right: 0.75 }
    })
  } finally {
    printer.destroy()
    await rm(folder, { recursive: true, force: true })
  }
}

/** Rebuilt from the report's blocks here, so only known blocks of plain text reach the document. */
function renderDocx(content: string): Buffer {
  const report = toReport(content)
  if (!report) throw new Error('Invalid report')
  return reportDocx(report)
}

/** Asks where to save, then writes the report. `content` is HTML for PDF and HTML, Markdown for Markdown, and the report's JSON for Word. */
export async function saveReport(window: BaseWindow, name: string, format: ReportFormat, content: string): Promise<boolean> {
  const title = name.replace(/[^\p{L}\p{N} ._-]/gu, '').trim() || 'Report'
  const { extension, label } = REPORT_FORMATS[format]
  const result = await dialog.showSaveDialog(window as BrowserWindow, {
    defaultPath: `${title}.${extension}`,
    filters: [{ name: label, extensions: [extension] }]
  })
  if (result.canceled || !result.filePath) return false
  await writeFile(result.filePath, format === 'pdf' ? await renderPdf(content, title) : format === 'docx' ? renderDocx(content) : content)
  return true
}

export const isReportSave = (args: unknown[]): args is [string, ReportFormat, string] =>
  args.length === 3 &&
  typeof args[0] === 'string' &&
  args[0].length <= 200 &&
  typeof args[1] === 'string' &&
  Object.hasOwn(REPORT_FORMATS, args[1]) &&
  typeof args[2] === 'string' &&
  args[2].length <= MAX_SIZE
