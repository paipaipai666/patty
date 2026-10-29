export interface TerminalSize {
  cols: number
  rows: number
}

const sameSize = (a: TerminalSize, b: TerminalSize) => a.cols === b.cols && a.rows === b.rows

export function createPtyResizeQueue(
  send: (size: TerminalSize) => Promise<void> | void,
  onError: (error: unknown) => void
) {
  let state: { confirmed: TerminalSize; desired: TerminalSize; failures: number } | null = null
  let sending = false
  let disposed = false
  let retry: ReturnType<typeof setTimeout> | undefined

  const pump = async (): Promise<void> => {
    if (disposed || sending || !state || sameSize(state.confirmed, state.desired)) return
    const active = state
    const size = active.desired
    sending = true
    try {
      await send(size)
      if (state === active) {
        active.confirmed = size
        active.failures = 0
      }
    } catch (error) {
      if (state === active) {
        active.failures++
        if (active.failures < 3) retry = setTimeout(() => { retry = undefined; void pump() }, 100 * active.failures)
        else onError(error)
      }
    } finally {
      sending = false
      if (state && (state !== active || !sameSize(state.desired, size))) void pump()
    }
  }

  const reset = (size: TerminalSize | null) => {
    clearTimeout(retry)
    retry = undefined
    state = size && !disposed ? { confirmed: size, desired: size, failures: 0 } : null
  }

  return {
    reset,
    request(size: TerminalSize) {
      if (!state || disposed) return
      state.desired = size
      if (state.failures >= 3) state.failures = 0
      if (!retry) void pump()
    },
    dispose() {
      disposed = true
      reset(null)
    }
  }
}
