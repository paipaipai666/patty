import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'

import { TitleBar } from '../TitleBar'

let terminalAPI: Record<string, any>

beforeEach(() => {
  terminalAPI = {
    windowMinimize: vi.fn(),
    windowMaximize: vi.fn(),
    windowClose: vi.fn(),
    onMaximizeChange: vi.fn(() => vi.fn())
  }
  ;(window as any).terminalAPI = terminalAPI
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  document.body.innerHTML = ''
})

afterEach(() => {
  delete (window as any).terminalAPI
})

function render(overrides: { onOpenSettings?: (() => void) | null; sidebarVisible?: boolean; onToggleSidebar?: () => void } = {}) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(
      <TitleBar
        onOpenSettings={overrides.onOpenSettings === undefined ? vi.fn() : (overrides.onOpenSettings as (() => void) | undefined)}
        sidebarVisible={overrides.sidebarVisible ?? true}
        onToggleSidebar={overrides.onToggleSidebar ?? vi.fn()}
      />
    )
  })
  return { container, root }
}

describe('TitleBar', () => {
  it('renders title "Patty"', () => {
    const { container } = render()
    expect(container.textContent).toContain('Patty')
  })

  it('sidebar toggle button calls onToggleSidebar', () => {
    const onToggle = vi.fn()
    const { container } = render({ onToggleSidebar: onToggle })
    const btn = container.querySelector('[aria-label="Hide sidebar"]')
    expect(btn).toBeTruthy()
    act(() => { btn!.click() })
    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it('settings button calls onOpenSettings', () => {
    const onOpen = vi.fn()
    const { container } = render({ onOpenSettings: onOpen })
    const btn = container.querySelector('[aria-label="Settings"]')
    expect(btn).toBeTruthy()
    act(() => { btn!.click() })
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('settings button is hidden when onOpenSettings is not provided', () => {
    // Pass explicit null to skip the default in render()
    const { container } = render({ onOpenSettings: null })
    // Also call the test via a different approach: mount with undefined explicitly
    document.body.innerHTML = ''
    const altContainer = document.createElement('div')
    document.body.appendChild(altContainer)
    const root = createRoot(altContainer)
    act(() => {
      root.render(<TitleBar sidebarVisible={true} onToggleSidebar={vi.fn()} />)
    })
    expect(altContainer.querySelector('[aria-label="Settings"]')).toBeNull()
    act(() => root.unmount())
  })

  it('window control buttons call terminalAPI methods', () => {
    const { container } = render()
    act(() => { (container.querySelector('[aria-label="Minimize"]') as HTMLButtonElement)?.click() })
    expect(terminalAPI.windowMinimize).toHaveBeenCalledTimes(1)
    act(() => { (container.querySelector('[aria-label="Maximize"]') as HTMLButtonElement)?.click() })
    expect(terminalAPI.windowMaximize).toHaveBeenCalledTimes(1)
    act(() => { (container.querySelector('[aria-label="Close"]') as HTMLButtonElement)?.click() })
    expect(terminalAPI.windowClose).toHaveBeenCalledTimes(1)
  })

  it('shows restore icon when maximized is true', () => {
    terminalAPI.onMaximizeChange = vi.fn((cb: (v: boolean) => void) => {
      cb(true)
      return vi.fn()
    })
    const { container } = render()
    expect(container.querySelector('[aria-label="Restore"]')).toBeTruthy()
  })

  it('shows maximize icon when maximized is false', () => {
    terminalAPI.onMaximizeChange = vi.fn((cb: (v: boolean) => void) => {
      cb(false)
      return vi.fn()
    })
    const { container } = render()
    expect(container.querySelector('[aria-label="Maximize"]')).toBeTruthy()
  })

  it('registers onMaximizeChange on mount and cleans up on unmount', () => {
    const cleanup = vi.fn()
    terminalAPI.onMaximizeChange = vi.fn(() => cleanup)
    const { root } = render()
    expect(terminalAPI.onMaximizeChange).toHaveBeenCalledTimes(1)
    act(() => root.unmount())
    expect(cleanup).toHaveBeenCalledTimes(1)
  })
})
