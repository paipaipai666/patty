import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: 'src/renderer',

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

    port: 1420,
    strictPort: true,

    host: '127.0.0.1'
  },
  clearScreen: false,
  plugins: [react()]
})
