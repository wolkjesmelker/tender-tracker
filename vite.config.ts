import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'
import path from 'path'

const projectRoot = __dirname
/** Alleen renderer in de browser (geen Electron-main/preload). Zet: VITE_WEB_ONLY=1 */
const webOnly = process.env.VITE_WEB_ONLY === '1'

export default defineConfig(({ mode }) => {
  // .env, .env.local, .env.[mode] (beide bestandsnamen zijn geldig)
  // Eerst bovenliggende map (Aanbestedingen/.env), daarna tender-tracker/ — laatste wint
  const parentRoot = path.join(projectRoot, '..')
  const env = {
    ...loadEnv(mode, parentRoot, ['NEXT_PUBLIC_', 'LICENSE_', 'VITE_']),
    ...loadEnv(mode, projectRoot, ['NEXT_PUBLIC_', 'LICENSE_', 'VITE_']),
  }
  const licenseUrl = env.LICENSE_SERVER_URL ?? process.env.LICENSE_SERVER_URL ?? ''
  const licenseKey = env.LICENSE_PRODUCT_KEY ?? process.env.LICENSE_PRODUCT_KEY ?? ''
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const supabaseKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''

  return {
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
                    __LICENSE_SERVER_URL__: JSON.stringify(licenseUrl),
                    __LICENSE_PRODUCT_KEY__: JSON.stringify(licenseKey),
                    __SUPABASE_URL__: JSON.stringify(supabaseUrl),
                    __SUPABASE_ANON_KEY__: JSON.stringify(supabaseKey),
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
  }
})
