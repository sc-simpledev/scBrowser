import { copyFileSync, mkdirSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'
import type { Plugin } from 'vite'

/** The strict CSP in our HTML blocks Vite's dev client, so it only ships in production builds. */
const stripCspInDev = (): Plugin => ({
  name: 'scb-strip-csp-in-dev',
  apply: 'serve',
  transformIndexHtml: (html) => html.replace(/<meta\s+http-equiv="Content-Security-Policy"[\s\S]*?\/>/, '')
})

/** The extension libraries look for their page scripts next to the bundled main process. */
const copyExtensionPreloads = (): Plugin => ({
  name: 'scb-copy-extension-preloads',
  closeBundle() {
    const out = resolve(__dirname, 'out/main')
    mkdirSync(out, { recursive: true })
    const { resolve: find } = createRequire(__filename)
    copyFileSync(find('electron-chrome-extensions/preload'), resolve(out, 'chrome-extension-api.preload.js'))
    copyFileSync(find('electron-chrome-web-store/preload'), resolve(out, 'chrome-web-store.preload.js'))
  }
})

/** Text recognition runs from files in the app, so scans never go anywhere. Vite serves this folder as it is. */
const copyOcrFiles = (): Plugin => ({
  name: 'scb-copy-ocr-files',
  buildStart() {
    const out = resolve(__dirname, 'src/renderer/public/ocr')
    mkdirSync(out, { recursive: true })
    const { resolve: find } = createRequire(__filename)
    const core = dirname(find('tesseract.js-core/package.json'))
    copyFileSync(join(dirname(find('tesseract.js/package.json')), 'dist/worker.min.js'), join(out, 'worker.min.js'))
    copyFileSync(join(dirname(find('@tesseract.js-data/eng/package.json')), '4.0.0/eng.traineddata.gz'), join(out, 'eng.traineddata.gz'))
    for (const file of readdirSync(core).filter((name) => name.endsWith('lstm.wasm.js'))) copyFileSync(join(core, file), join(out, file))
  }
})

// Everything (including workspace packages) is listed under devDependencies, so
// electron-vite bundles it rather than leaving it as a runtime `require`.
export default defineConfig({
  main: {
    plugins: [copyExtensionPreloads()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') }
      }
    }
  },
  preload: {
    build: {
      // Sandboxed preloads can't load shared chunks, so each entry is bundled on its own.
      isolatedEntries: true,
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
          overlay: resolve(__dirname, 'src/preload/overlay.ts'),
          internal: resolve(__dirname, 'src/preload/internal.ts')
        }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [react(), tailwindcss(), stripCspInDev(), copyOcrFiles()],
    build: {
      minify: true,
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
          overlay: resolve(__dirname, 'src/renderer/overlay.html'),
          internal: resolve(__dirname, 'src/renderer/internal.html')
        }
      }
    }
  }
})
