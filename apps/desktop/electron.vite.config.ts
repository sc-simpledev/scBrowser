import { resolve } from 'node:path'
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

// Everything (including workspace packages) is listed under devDependencies, so
// electron-vite bundles it rather than leaving it as a runtime `require`.
export default defineConfig({
  main: {
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
    plugins: [react(), tailwindcss(), stripCspInDev()],
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
