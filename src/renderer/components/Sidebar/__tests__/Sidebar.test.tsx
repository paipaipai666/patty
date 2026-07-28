import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
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
      notifications: {},
      sshProfiles: []
    },
    openSettings: vi.fn()
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
import { useSettingsStore } from '../../../store/settingsStore'
import type { SshProfile } from '../../../../shared/settingsTypes'

// The mocked useSettingsStore is untyped (vi.mock factory); assert the slice
// shape this suite mutates. Runtime value is the mock defined above.
interface SettingsMockState {
  settings: { sshProfiles: SshProfile[] }
  openSettings: Mock
}
function settingsMockState(): SettingsMockState {
  const mocked = useSettingsStore as unknown as (sel: (s: SettingsMockState) => unknown) => SettingsMockState
  return mocked((s) => s)
}

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
    onNewSsh: vi.fn(),
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

  it('menu contains New SSH Connection which opens the profile picker', () => {
    const settingsState = settingsMockState()
    settingsState.settings.sshProfiles = [
      { id: 'p1', name: 'prod', host: '10.0.0.5', user: 'deploy', port: 2222 }
    ]
    const { container } = render()
    const btn = container.querySelector('button[aria-label="New terminal or collection"]')!
    act(() => { btn.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    const sshItem = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('New SSH Connection')
    )!
    act(() => { sshItem.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    const profileBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('prod')
    )
    expect(profileBtn).not.toBeUndefined()
    expect(profileBtn!.textContent).toContain('deploy@10.0.0.5:2222')
    settingsState.settings.sshProfiles = []
  })

  it('clicking a profile in the picker calls onNewSsh with it', () => {
    const settingsState = settingsMockState()
    const profile = { id: 'p1', name: 'prod', host: '10.0.0.5', user: 'deploy' }
    settingsState.settings.sshProfiles = [profile]
    const onNewSsh = vi.fn()
    const { container } = render({ onNewSsh })
    const btn = container.querySelector('button[aria-label="New terminal or collection"]')!
    act(() => { btn.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    const sshItem = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('New SSH Connection')
    )!
    act(() => { sshItem.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    const profileBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('prod')
    )!
    act(() => { profileBtn.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(onNewSsh).toHaveBeenCalledWith(profile)
    settingsState.settings.sshProfiles = []
  })

  it('empty picker shows hint and Manage opens settings at ssh category', () => {
    const settingsState = settingsMockState()
    settingsState.settings.sshProfiles = []
    const { container } = render()
    const btn = container.querySelector('button[aria-label="New terminal or collection"]')!
    act(() => { btn.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    const sshItem = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('New SSH Connection')
    )!
    act(() => { sshItem.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(container.textContent).toContain('No SSH profiles')
    const manageBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Manage SSH Profiles')
    )!
    act(() => { manageBtn.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(settingsState.openSettings).toHaveBeenCalledWith('ssh')
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
