import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: 'src/renderer',
  // Relative asset paths: the production build is served from Tauri's custom
  // protocol, not a server root.
  base: './',
  resolve: {
    alias: {
      '@': resolve('src/renderer')
    }
  },
  build: {
    outDir: resolve('out/renderer'),
    emptyOutDir: true,
    target: 'es2022'
  },
  server: {
    // Tauri requires a fixed devUrl port.
    port: 1420,
    strictPort: true,
    // Pin IPv4 — see the note in the old electron.vite.config.ts; localhost
    // resolves to ::1 on Windows while the webview tries 127.0.0.1.
    host: '127.0.0.1'
  },
  clearScreen: false,
  plugins: [react()]
})
