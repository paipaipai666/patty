import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'

import { TitleBar } from '../TitleBar'
import { useWorkspaceStore } from '../../../store/workspaceStore'

let terminalAPI: Record<string, any>

beforeEach(() => {
  useWorkspaceStore.setState({ workspaces: [], activeWorkspaceId: null })
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

function render(
  overrides: {
    onOpenCommands?: () => void
    sidebarVisible?: boolean
    onToggleSidebar?: () => void
  } = {}
) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(
      <TitleBar
        onOpenCommands={overrides.onOpenCommands}
        sidebarVisible={overrides.sidebarVisible ?? true}
        onToggleSidebar={overrides.onToggleSidebar ?? vi.fn()}
      />
    )
  })
  return { container, root }
}

describe('TitleBar', () => {
  it('keeps the collapse button available without repeated labels and controls', () => {
    const onToggle = vi.fn()
    const { container } = render({ onToggleSidebar: onToggle })
    expect(container.textContent).not.toContain('Patty')
    expect(container.querySelectorAll('button')).toHaveLength(4)
    expect(container.querySelector('[aria-label="Settings"]')).toBeNull()
    const button = container.querySelector<HTMLButtonElement>('[aria-label="Hide sidebar"]')!
    expect(button.getAttribute('aria-pressed')).toBe('true')
    expect(button.title).toBe('Hide sidebar')
    act(() => button.click())
    expect(onToggle).toHaveBeenCalledTimes(1)
    expect(container.querySelector('[aria-label="Open command palette"]')).toBeNull()
    expect(container.querySelector('[data-tauri-drag-region]')).not.toBeNull()
  })

  it('keeps restore-sidebar and search buttons available when the sidebar is hidden', () => {
    const onToggle = vi.fn()
    const onSearch = vi.fn()
    const { container } = render({ sidebarVisible: false, onToggleSidebar: onToggle, onOpenCommands: onSearch })
    const button = container.querySelector<HTMLButtonElement>('[aria-label="Show sidebar"]')!
    expect(button.getAttribute('aria-pressed')).toBe('false')
    expect(button.title).toBe('Show sidebar')
    act(() => button.click())
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Open command palette"]')!.click())
    expect(onToggle).toHaveBeenCalledTimes(1)
    expect(onSearch).toHaveBeenCalledTimes(1)
  })

  it('window control buttons call terminalAPI methods', () => {
    const { container } = render()
    act(() => {
      ;(
        container.querySelector('[aria-label="Minimize"]') as HTMLButtonElement
      )?.click()
    })
    expect(terminalAPI.windowMinimize).toHaveBeenCalledTimes(1)
    act(() => {
      ;(
        container.querySelector('[aria-label="Maximize"]') as HTMLButtonElement
      )?.click()
    })
    expect(terminalAPI.windowMaximize).toHaveBeenCalledTimes(1)
    act(() => {
      ;(
        container.querySelector('[aria-label="Close"]') as HTMLButtonElement
      )?.click()
    })
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
