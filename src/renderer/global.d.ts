import type { TerminalAPI } from '../preload/index'

declare global {
  interface Window {
    terminalAPI: TerminalAPI
  }
}
