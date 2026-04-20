import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'
import path from 'path'

const projectRoot = __dirname
/** Alleen renderer in de browser (geen Electron-main/preload). Zet: VITE_WEB_ONLY=1 */
const webOnly = process.env.VITE_WEB_ONLY === '1'

export default defineConfig({
  plugins: [
    react(),
    ...(webOnly
      ? []
      : [
          electron([
            {
              entry: path.join(projectRoot, 'src/main/index.ts'),
              vite: {
                build: {
                  outDir: path.join(projectRoot, 'dist-electron/main'),
                  define: {
                    __LICENSE_SERVER_URL__: JSON.stringify(process.env.LICENSE_SERVER_URL ?? ''),
                    __LICENSE_PRODUCT_KEY__: JSON.stringify(process.env.LICENSE_PRODUCT_KEY ?? ''),
                  },
                  rollupOptions: {
                    external: [
                      'better-sqlite3', 'electron', 'electron-log', 'node-cron',
                      'pdfmake', 'docx', 'pdf-parse', 'cheerio', 'adm-zip',
                      'electron-updater',
                    ]
                  }
                }
              }
            },
            {
              entry: path.join(projectRoot, 'src/main/preload.ts'),
              onstart(args) {
                args.reload()
              },
              vite: {
                build: {
                  outDir: path.join(projectRoot, 'dist-electron/preload'),
                  rollupOptions: {
                    external: ['electron']
                  }
                }
              }
            }
          ]),
          renderer(),
        ]),
  ],
  server: webOnly
    ? {
        open: '/#/aanbestedingen',
      }
    : undefined,
  resolve: {
    alias: {
      '@': path.resolve(projectRoot, 'src/renderer'),
      '@shared': path.resolve(projectRoot, 'src/shared')
    }
  },
  root: path.join(projectRoot, 'src/renderer'),
  build: {
    outDir: path.join(projectRoot, 'dist'),
    emptyOutDir: true
  }
})
