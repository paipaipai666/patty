import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { useWindowMaterial } from '../useWindowMaterial'
import { useSettingsStore } from '../../store/settingsStore'
import { DEFAULT_SETTINGS } from '../../../shared/defaultSettings'
import type { WindowMaterial, WindowMaterialRequest } from '../../../shared/windowMaterial'

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>
const apply = vi.fn<(request: WindowMaterialRequest) => Promise<WindowMaterial>>()
const media = Object.assign(new EventTarget(), { matches: false })
let focused = true

function Harness() { useWindowMaterial(); return null }
async function mount() { await act(async () => root.render(<Harness />)) }

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  vi.useFakeTimers()
  focused = true
  media.matches = false
  vi.spyOn(document, 'hasFocus').mockImplementation(() => focused)
  vi.stubGlobal('matchMedia', () => media)
  apply.mockReset().mockImplementation(async request => request.enabled ? 'mica' : 'solid')
  Object.defineProperty(window, 'terminalAPI', { configurable: true, value: { windowSetMaterial: apply } })
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS }, loaded: true })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('uses an opaque fallback color and selects the native appearance from the actual theme', async () => {
  await mount()
  expect(apply).toHaveBeenLastCalledWith({ enabled: true, appearance: 'dark', background: [27, 29, 32] })
  expect(document.documentElement.dataset.windowMaterial).toBe('mica')
  await act(async () => useSettingsStore.setState(state => ({ settings: { ...state.settings, theme: 'light' } })))
  expect(apply).toHaveBeenLastCalledWith({ enabled: true, appearance: 'light', background: [246, 247, 249] })
})

it('waits for saved settings before exposing the native background', async () => {
  useSettingsStore.setState({ loaded: false })
  await mount()
  expect(apply).not.toHaveBeenCalled()
  expect(document.documentElement.dataset.windowMaterial).toBe('solid')
  await act(async () => useSettingsStore.setState(state => ({ loaded: true, settings: { ...state.settings, theme: 'light' } })))
  expect(apply).toHaveBeenCalledTimes(1)
  expect(apply.mock.lastCall?.[0].appearance).toBe('light')
})

it('respects forced colors, loss of focus and a user choosing solid color', async () => {
  await mount()
  await act(async () => { focused = false; window.dispatchEvent(new Event('blur')) })
  expect(apply.mock.lastCall?.[0].enabled).toBe(false)
  expect(document.documentElement.dataset.windowMaterial).toBe('solid')
  await act(async () => { focused = true; window.dispatchEvent(new Event('focus')) })
  expect(document.documentElement.dataset.windowMaterial).toBe('mica')
  await act(async () => { media.matches = true; media.dispatchEvent(new Event('change')) })
  expect(document.documentElement.dataset.windowMaterial).toBe('solid')
  media.matches = false
  await act(async () => useSettingsStore.setState(state => ({ settings: { ...state.settings, windowMaterial: 'solid' } })))
  expect(apply.mock.lastCall?.[0].enabled).toBe(false)
  const calls = apply.mock.calls.length
  await act(async () => vi.advanceTimersByTime(4000))
  expect(apply).toHaveBeenCalledTimes(calls)
})

it('refreshes system policy while active and stays opaque after a native failure', async () => {
  await mount()
  apply.mockRejectedValueOnce(new Error('Native background unavailable'))
  await act(async () => vi.advanceTimersByTime(2000))
  expect(document.documentElement.dataset.windowMaterial).toBe('solid')
  await act(async () => vi.advanceTimersByTime(2000))
  expect(document.documentElement.dataset.windowMaterial).toBe('mica')
})

it('ignores an old response after changing theme or unmounting', async () => {
  const pending: Array<(mode: WindowMaterial) => void> = []
  apply.mockImplementation(() => new Promise(resolve => pending.push(resolve)))
  await mount()
  await act(async () => useSettingsStore.setState(state => ({ settings: { ...state.settings, theme: 'light' } })))
  await act(async () => pending[1]('mica'))
  await act(async () => pending[0]('solid'))
  expect(document.documentElement.dataset.windowMaterial).toBe('mica')
  await act(async () => vi.advanceTimersByTime(2000))
  act(() => root.render(null))
  await act(async () => pending[2]('mica'))
  expect(document.documentElement.dataset.windowMaterial).toBe('solid')
})
