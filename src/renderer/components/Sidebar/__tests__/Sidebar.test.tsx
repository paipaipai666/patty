import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'

vi.mock('../../../store/settingsStore', () => {
  const state: any = {
    settings: {
      sidebarPosition: 'left',
      theme: 'dark',
      fontFamily: 'Consolas',
      fontSize: 14,
      cursorBlink: true,
      cursorStyle: 'block',
      opacity: 1,
      scrollback: 5000,
      defaultShell: 'powershell',
      customThemes: [],
      shortcuts: {},
      notifications: {}
    }
  }
  const useSettingsStore = (sel: (s: typeof state) => unknown) => sel(state)
  return { useSettingsStore }
})

vi.mock('../../../store/sessionStore', () => {
  const state: any = {
    sidebarWidth: 220,
    setSidebarWidth: vi.fn(),
    addCollection: vi.fn(),
    sessions: [],
    collections: [],
    activeSessionId: null,
    loaded: true,
    attentionMap: {},
    draggingSessionId: null,
    getState: () => state
  }
  const useSessionStore = (sel: (s: typeof state) => unknown) => sel(state)
  useSessionStore.getState = () => state
  return { useSessionStore }
})

import { Sidebar } from '../Sidebar'
import { useSessionStore } from '../../../store/sessionStore'

beforeEach(() => {
  vi.clearAllMocks()
  const s = useSessionStore.getState()
  s.sidebarWidth = 220
  s.sessions = []
  s.collections = []
  document.body.innerHTML = ''
})

function render(props: Partial<Parameters<typeof Sidebar>[0]> = {}) {
  const allProps = {
    onNewTerminal: vi.fn(),
    onNewTerminalPickFolder: vi.fn(),
    onCloseSession: vi.fn(),
    onSelectSession: vi.fn(),
    ...props
  }
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => { root.render(<Sidebar {...allProps} />) })
  return { container, root, props: allProps }
}

describe('Sidebar', () => {
  it('renders sidebar with search input', () => {
    const { container } = render()
    const search = container.querySelector('input[aria-label="Search sessions"]')
    expect(search).not.toBeNull()
  })

  it('renders new terminal/collection button', () => {
    const { container } = render()
    const btn = container.querySelector('button[aria-label="New terminal or collection"]')
    expect(btn).not.toBeNull()
  })

  it('toggling dropdown menu shows New Terminal and New Collection options', () => {
    const { container } = render()
    const btn = container.querySelector('button[aria-label="New terminal or collection"]')!
    act(() => { btn.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    const buttons = container.querySelectorAll('button')
    const labels = Array.from(buttons).map((b) => b.textContent).filter(Boolean)
    expect(labels.some((l) => l?.includes('New Terminal'))).toBe(true)
    expect(labels.some((l) => l?.includes('New Collection'))).toBe(true)
  })

  it('New Terminal click calls onNewTerminal', () => {
    const onNewTerminal = vi.fn()
    const { container } = render({ onNewTerminal })
    const btn = container.querySelector('button[aria-label="New terminal or collection"]')!
    act(() => { btn.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    const items = container.querySelectorAll('button')
    const newTermBtn = Array.from(items).find((b) => b.textContent?.includes('New Terminal'))!
    act(() => { newTermBtn.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(onNewTerminal).toHaveBeenCalled()
  })

  it('New Terminal (Choose Folder) click calls onNewTerminalPickFolder', () => {
    const onNewTerminalPickFolder = vi.fn()
    const { container } = render({ onNewTerminalPickFolder })
    const btn = container.querySelector('button[aria-label="New terminal or collection"]')!
    act(() => { btn.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    const items = container.querySelectorAll('button')
    const pickBtn = Array.from(items).find((b) => b.textContent?.includes('Choose Folder'))!
    act(() => { pickBtn.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(onNewTerminalPickFolder).toHaveBeenCalled()
  })

  it('creating collection input appears after clicking New Collection', () => {
    const { container } = render()
    const btn = container.querySelector('button[aria-label="New terminal or collection"]')!
    act(() => { btn.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    const items = container.querySelectorAll('button')
    const newColBtn = Array.from(items).find((b) => b.textContent?.includes('New Collection'))!
    act(() => { newColBtn.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    const inputs = container.querySelectorAll('input')
    const colInput = Array.from(inputs).find((i) => i.placeholder === 'Collection name...')
    expect(colInput).not.toBeNull()
  })

  it('creating collection input submits on Enter', () => {
    const { container } = render()
    const btn = container.querySelector('button[aria-label="New terminal or collection"]')!
    act(() => { btn.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    const items = container.querySelectorAll('button')
    const newColBtn = Array.from(items).find((b) => b.textContent?.includes('New Collection'))!
    act(() => { newColBtn.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    const inputs = container.querySelectorAll('input')
    const colInput = Array.from(inputs).find((i) => i.placeholder === 'Collection name...')!
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
    act(() => {
      nativeSetter.call(colInput, 'My Group')
      colInput.dispatchEvent(new Event('input', { bubbles: true }))
    })
    act(() => { colInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
    expect(useSessionStore.getState().addCollection).toHaveBeenCalledWith('My Group')
  })

  it('resize handle mousedown triggers width listeners', () => {
    const { container } = render()
    const sidebar = container.firstElementChild!
    const handle = sidebar.lastElementChild!
    act(() => {
      handle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 200 }))
    })
    act(() => {
      document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 250 }))
    })
    expect(useSessionStore.getState().setSidebarWidth).toHaveBeenCalled()
  })

  it('renders resize handle', () => {
    const { container } = render()
    const sidebar = container.firstElementChild!
    const handle = sidebar.lastElementChild!
    expect(handle).not.toBeNull()
  })
})
