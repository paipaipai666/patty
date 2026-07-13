import { isIgnorableNetworkError } from './ptyManager'

export function onUncaughtException(error: unknown): void {
  if (isIgnorableNetworkError(error)) {
    console.error('[main] ignored uncaught network abort:', (error as Error).message)
    return
  }
  console.error('[main] fatal uncaught exception:', error)
  process.exit(1)
}

export function onUnhandledRejection(reason: unknown): void {
  if (reason instanceof Error && isIgnorableNetworkError(reason)) {
    console.error('[main] ignored unhandled network abort:', reason.message)
    return
  }
  // Never exit on unhandled rejections: in an event-driven Electron app they
  // are almost always recoverable (an escaped promise, a metrics PowerShell
  // error), and exiting would kill every live PTY shell and the hook server.
  console.error('[main] unhandled rejection (continuing):', reason)
}
