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
    target: 'es2022',
    rollupOptions: {
      output: {
        // Split the xterm bundle out of the main chunk so the app shell parses
        // first; the terminal chunk loads in parallel.
        manualChunks: {
          xterm: [
            '@xterm/xterm',
            '@xterm/addon-canvas',
            '@xterm/addon-fit',
            '@xterm/addon-image',
            '@xterm/addon-unicode11',
            '@xterm/addon-web-links',
            '@xterm/addon-webgl'
          ]
        }
      }
    }
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
