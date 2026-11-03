import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ContributionGrid } from '../ContributionGrid'
import { registerGrid, unregisterGrid } from '../../../utils/gridScheduler'

vi.mock('../../../utils/gridScheduler', () => ({ registerGrid: vi.fn(), unregisterGrid: vi.fn() }))

let root: Root
let container: HTMLDivElement
let intersection: (visible: boolean) => void
let resize: () => void
let colors: string[]
let motion: MediaQueryList
const context = { clearRect: vi.fn(), scale: vi.fn(), beginPath: vi.fn(), roundRect: vi.fn(), fillStyle: '', fill: vi.fn() }
const getContext = HTMLCanvasElement.prototype.getContext

beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  colors = []
  context.fill.mockImplementation(() => colors.push(context.fillStyle))
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', { configurable: true, value: () => context })
  motion = Object.assign(new EventTarget(), {
    matches: false, media: '(prefers-reduced-motion: reduce)', onchange: null,
    addListener: vi.fn(), removeListener: vi.fn()
  })
  vi.stubGlobal('matchMedia', () => motion)
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
      intersection = visible => callback([{ isIntersecting: visible }])
    }
    observe() {}
    disconnect() {}
  })
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resize = callback }
    observe() {}
    disconnect() {}
  })
  container = document.createElement('div')
  Object.defineProperties(container, { offsetWidth: { value: 200 }, offsetHeight: { value: 48 } })
  document.body.appendChild(container)
  root = createRoot(container)
  document.documentElement.style.setProperty('--fire-claude', '#cc44cc')
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  document.documentElement.style.removeProperty('--fire-claude')
  vi.restoreAllMocks()
  HTMLCanvasElement.prototype.getContext = getContext
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

function render() {
  act(() => root.render(<ContributionGrid aiType="claude" />))
  const grid = vi.mocked(registerGrid).mock.calls.at(-1)?.[0]
  if (!grid) throw new Error('Animation did not start')
  return grid
}

describe('working animation lifecycle', () => {
  it('shows a developed trail on its first scheduled frame', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99)
    const grid = render()
    grid.tick()
    expect(context.roundRect).toHaveBeenCalledWith(6, 6, 5, 5, 1)
  })

  it('draws with the agent color and refreshes it after a theme change', async () => {
    const grid = render()
    grid.tick()
    expect(colors).toContain('rgba(204,68,204,1.0)')
    colors.length = 0
    await act(async () => { document.documentElement.style.setProperty('--fire-claude', '#102030') })
    grid.tick()
    expect(colors).toContain('rgba(16,32,48,1.0)')
    expect(colors).not.toContain('rgba(204,68,204,1.0)')
  })

  it('does not start drawing when reduced motion is enabled initially', () => {
    Object.defineProperty(motion, 'matches', { value: true })
    act(() => root.render(<ContributionGrid aiType="claude" />))
    expect(registerGrid).not.toHaveBeenCalled()
    expect(context.fill).not.toHaveBeenCalled()
  })

  it('pauses on reduced motion changes and resumes only while visible', () => {
    const grid = render()
    Object.defineProperty(motion, 'matches', { value: true, configurable: true })
    act(() => motion.dispatchEvent(new Event('change')))
    expect(unregisterGrid).toHaveBeenLastCalledWith(grid)
    intersection(false)
    vi.mocked(registerGrid).mockClear()
    Object.defineProperty(motion, 'matches', { value: false, configurable: true })
    act(() => motion.dispatchEvent(new Event('change')))
    expect(registerGrid).not.toHaveBeenCalled()
    intersection(true)
    expect(registerGrid).toHaveBeenCalledWith(grid)
  })

  it('does not resume an offscreen animation after a resize', () => {
    vi.useFakeTimers()
    render()
    intersection(false)
    vi.mocked(registerGrid).mockClear()
    resize()
    resize()
    act(() => vi.advanceTimersByTime(200))
    expect(registerGrid).not.toHaveBeenCalled()
    intersection(true)
    expect(registerGrid).toHaveBeenCalledTimes(1)
  })

  it('releases the animation and media listener after removing the agent', () => {
    const grid = render()
    act(() => root.render(<ContributionGrid aiType={null} />))
    expect(unregisterGrid).toHaveBeenLastCalledWith(grid)
    vi.mocked(registerGrid).mockClear()
    act(() => motion.dispatchEvent(new Event('change')))
    expect(registerGrid).not.toHaveBeenCalled()
    expect(container.querySelector('canvas')).toBeNull()
  })
})
