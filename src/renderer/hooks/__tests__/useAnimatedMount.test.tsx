import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'

import { useAnimatedMount } from '../useAnimatedMount'

function TestComponent({ show, exitDuration }: { show: boolean; exitDuration?: number }) {
  const { mounted, exiting } = useAnimatedMount(show, exitDuration)
  return (
    <div>
      <span data-testid="mounted">{String(mounted)}</span>
      <span data-testid="exiting">{String(exiting)}</span>
    </div>
  )
}

function render(props: { show: boolean; exitDuration?: number }) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => { root.render(<TestComponent {...props} />) })
  return { container, root }
}

function read(container: HTMLElement) {
  const mounted = container.querySelector('[data-testid="mounted"]')!.textContent!
  const exiting = container.querySelector('[data-testid="exiting"]')!.textContent!
  return { mounted: mounted === 'true', exiting: exiting === 'true' }
}

describe('useAnimatedMount', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  it('mounted=true and exiting=false when show=true', () => {
    const { container } = render({ show: true })
    const state = read(container)
    expect(state.mounted).toBe(true)
    expect(state.exiting).toBe(false)
  })

  it('mounted=false but exiting=true when show=false initially (effect fires immediately)', () => {
    const { container } = render({ show: false })
    const state = read(container)
    expect(state.mounted).toBe(false)
    expect(state.exiting).toBe(true)
  })

  it('exiting=true then mounted=false after exitDuration ms when show transitions to false', () => {
    const { container, root } = render({ show: true })

    let state = read(container)
    expect(state.mounted).toBe(true)

    act(() => { root.render(<TestComponent show={false} exitDuration={200} />) })

    state = read(container)
    expect(state.mounted).toBe(true)
    expect(state.exiting).toBe(true)

    act(() => { vi.advanceTimersByTime(200) })

    state = read(container)
    expect(state.mounted).toBe(false)
    expect(state.exiting).toBe(false)

    root.unmount()
  })

  it('uses default exitDuration of 200ms', () => {
    const { container, root } = render({ show: true })

    act(() => { root.render(<TestComponent show={false} />) })

    let state = read(container)
    expect(state.exiting).toBe(true)

    act(() => { vi.advanceTimersByTime(200) })

    state = read(container)
    expect(state.mounted).toBe(false)

    root.unmount()
  })
})
