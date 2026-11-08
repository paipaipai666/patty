import type { Terminal } from '@xterm/xterm'
import { parseNavigationPosition, type NavigationPosition } from '../../shared/ompNavigationTypes'

export function registerOmpFrameObserver(term: Terminal, options: {
  visible(): boolean
  observe(position: NavigationPosition): void
  schedule?: (callback: () => void) => number
  cancel?: (handle: number) => void
}) {
  const schedule = options.schedule ?? requestAnimationFrame
  const cancel = options.cancel ?? cancelAnimationFrame
  let pending: NavigationPosition | null = null
  let handle: number | null = null
  let disposed = false
  let observedFrame = ''
  const inspect = () => {
    handle = null
    if (disposed || !pending || !options.visible()) return
    const buffer = term.buffer.active
    if (buffer.type !== (pending.mode === 'browsing' ? 'alternate' : 'normal') || buffer.viewportY !== buffer.baseY) return
    if (pending.frameId === observedFrame) return
    observedFrame = pending.frameId
    options.observe(pending)
  }
  const refresh = () => {
    if (disposed || !pending || handle !== null) return
    handle = schedule(() => { handle = schedule(inspect) })
  }
  const parser = term.parser.registerOscHandler(777, data => {
    if (!data.startsWith('patty-nav-v1;')) return false
    const encoded = data.slice('patty-nav-v1;'.length)
    if (encoded.length > 8192 || !/^[A-Za-z0-9_-]+$/.test(encoded)) return true
    try {
      const binary = atob(encoded.replace(/-/g, '+').replace(/_/g, '/'))
      const bytes = Uint8Array.from(binary, character => character.charCodeAt(0))
      const position = parseNavigationPosition(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)))
      if (position && position.frameId) pending = position
    } catch {}
    return true
  })
  const parsed = term.onWriteParsed(refresh)
  const rendered = term.onRender(refresh)
  return { refresh, dispose() {
    disposed = true
    parser.dispose()
    parsed.dispose()
    rendered.dispose()
    if (handle !== null) cancel(handle)
    pending = null
  } }
}
