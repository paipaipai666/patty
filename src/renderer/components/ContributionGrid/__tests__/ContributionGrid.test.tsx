import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'

vi.mock('../../../utils/gridScheduler', () => ({
  registerGrid: vi.fn(),
  unregisterGrid: vi.fn()
}))

import { ContributionGrid, parseRgb } from '../ContributionGrid'

beforeEach(() => {
  document.body.innerHTML = ''
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  ;(globalThis as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  ;(globalThis as any).IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  // Mock canvas context to prevent jsdom errors
  HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
    clearRect: vi.fn(),
    scale: vi.fn(),
    beginPath: vi.fn(),
    fill: vi.fn(),
    roundRect: vi.fn(),
  } as any)
  const style = document.documentElement.style
  style.setProperty('--fire-claude', '#cc44cc')
  style.setProperty('--fire-glow-claude-3', 'rgba(200,60,200,0.25)')
  style.setProperty('--fire-glow-claude-4', 'rgba(200,60,200,0.5)')
})

function render(aiType: 'claude' | 'opencode' | 'codex' | 'omp' | null) {
  const container = document.createElement('div')
  container.style.width = '200px'
  container.style.height = '100px'
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => { root.render(<ContributionGrid aiType={aiType} />) })
  return { container, root }
}

describe('ContributionGrid', () => {
  it('returns null when aiType is null', () => {
    const { container } = render(null)
    expect(container.innerHTML).toBe('')
  })

  it('renders container div and canvas for valid aiType', () => {
    const { container } = render('claude')
    const div = container.querySelector('div')
    expect(div).toBeTruthy()
    const canvas = container.querySelector('canvas')
    expect(canvas).toBeTruthy()
  })

  it('sets dataset.type attribute on container', () => {
    const { container } = render('opencode')
    const div = container.firstElementChild as HTMLElement
    expect(div?.dataset?.type).toBe('opencode')
  })

  it('sets dataset.type for codex', () => {
    const { container } = render('codex')
    const div = container.firstElementChild as HTMLElement
    expect(div?.dataset?.type).toBe('codex')
  })

  it('sets dataset.type for omp', () => {
    const { container } = render('omp')
    const div = container.firstElementChild as HTMLElement
    expect(div?.dataset?.type).toBe('omp')
  })
})

describe('parseRgb', () => {
  it('parses rgb() function syntax', () => {
    expect(parseRgb('rgb(100, 200, 50)')).toEqual([100, 200, 50])
  })

  it('parses rgba() function syntax (ignores alpha)', () => {
    expect(parseRgb('rgba(255, 0, 128, 0.5)')).toEqual([255, 0, 128])
  })

  it('parses 6-digit hex color', () => {
    expect(parseRgb('#ff8000')).toEqual([255, 128, 0])
  })

  it('parses hex with uppercase letters', () => {
    expect(parseRgb('#AA00CC')).toEqual([170, 0, 204])
  })

  it('returns fallback [200,200,200] for short hex', () => {
    expect(parseRgb('#fff')).toEqual([200, 200, 200])
  })

  it('returns fallback for empty string', () => {
    expect(parseRgb('')).toEqual([200, 200, 200])
  })

  it('returns fallback for invalid color', () => {
    expect(parseRgb('not-a-color')).toEqual([200, 200, 200])
  })
})
