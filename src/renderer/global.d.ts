import type { TerminalAPI } from './api'

declare global {
  interface Window {
    terminalAPI: TerminalAPI
  }
}
