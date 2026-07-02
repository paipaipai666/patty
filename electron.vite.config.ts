import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        external: ['node-pty']
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: {
      alias: {
        '@': resolve('src/renderer')
      }
    },
    server: {
      // Vite 5 defaults `host` to 'localhost', which Node resolves to IPv6
      // `[::1]` only on Windows. Chromium's `localhost` lookup often resolves
      // to IPv4 `127.0.0.1`, so the renderer dev server isn't reachable and
      // Electron shows ERR_CONNECTION_REFUSED + a black window. Pin IPv4.
      host: '127.0.0.1'
    },
    plugins: [react()]
  }
})
