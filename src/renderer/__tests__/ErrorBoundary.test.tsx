import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'

import { ErrorBoundary } from '../ErrorBoundary'

function ThrowingChild({ message }: { message: string }): never {
  throw new Error(message)
}

function SafeChild({ label }: { label: string }) {
  return <div>{label}</div>
}

function render(element: React.ReactElement) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => { root.render(element) })
  return { container, root }
}

describe('ErrorBoundary', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    document.body.innerHTML = ''
  })

  it('renders children normally when no error', () => {
    const { container } = render(
      <ErrorBoundary>
        <SafeChild label="hello" />
      </ErrorBoundary>
    )
    expect(container.textContent).toBe('hello')
  })

  it('catches errors and shows error UI when child throws', () => {
    const { container } = render(
      <ErrorBoundary>
        <ThrowingChild message="boom" />
      </ErrorBoundary>
    )
    expect(container.textContent).toContain('Something went wrong')
  })

  it('shows error message from thrown error', () => {
    const { container } = render(
      <ErrorBoundary>
        <ThrowingChild message="disk full" />
      </ErrorBoundary>
    )
    expect(container.textContent).toContain('disk full')
  })

  it('keeps showing the error after a click, because the page is reloading', () => {
    const reload = vi.fn()
    vi.stubGlobal('location', { ...window.location, reload })

    const { container } = render(
      <ErrorBoundary>
        <ThrowingChild message="first error" />
      </ErrorBoundary>
    )
    expect(container.textContent).toContain('first error')

    const reloadBtn = container.querySelector('button')!
    act(() => {
      reloadBtn.click()
    })

    expect(reload).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain('first error')
    vi.unstubAllGlobals()
  })

  it('reload button reloads the document so a deterministic error cannot persist', () => {
    const reload = vi.fn()
    vi.stubGlobal('location', { ...window.location, reload })

    const { container } = render(
      <ErrorBoundary>
        <ThrowingChild message="fatal" />
      </ErrorBoundary>
    )

    const reloadBtn = container.querySelector('button')!
    act(() => {
      reloadBtn.click()
    })

    expect(reload).toHaveBeenCalledTimes(1)
    vi.unstubAllGlobals()
  })
})
