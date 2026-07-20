import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'

vi.mock('../../../utils/gridScheduler', () => ({
  registerGrid: vi.fn(),
  unregisterGrid: vi.fn()
}))

import { ContributionGrid } from '../ContributionGrid'

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

function render(aiType: 'claude' | 'opencode' | 'codex' | null) {
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
})
