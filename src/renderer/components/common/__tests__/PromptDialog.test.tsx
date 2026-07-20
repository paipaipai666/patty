import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'

import { PromptDialog, type PromptOptions } from '../PromptDialog'

function render(props: { show: boolean; options: PromptOptions }) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => { root.render(<PromptDialog {...props} />) })
  return { container, root }
}

describe('PromptDialog', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    document.body.innerHTML = ''
  })

  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  it('renders null when show=false', () => {
    const { container } = render({
      show: false,
      options: { title: 'Test', onSubmit: vi.fn(), onCancel: vi.fn() }
    })
    expect(container.innerHTML).toBe('')
  })

  it('shows dialog when show=true with provided options', () => {
    const { container } = render({
      show: true,
      options: { title: 'Enter name', onSubmit: vi.fn(), onCancel: vi.fn() }
    })
    const dialog = container.querySelector('[role="dialog"]')
    expect(dialog).not.toBeNull()
    expect(dialog!.getAttribute('aria-label')).toBe('Enter name')
    expect(container.textContent).toContain('Enter name')
  })

  it('input field has defaultValue pre-filled', () => {
    const { container } = render({
      show: true,
      options: { title: 'Rename', defaultValue: 'hello', onSubmit: vi.fn(), onCancel: vi.fn() }
    })
    const input = container.querySelector('input') as HTMLInputElement
    expect(input).not.toBeNull()
    expect(input.value).toBe('hello')
  })

  it('Enter key triggers onSubmit with current value', () => {
    const onSubmit = vi.fn()
    const { container } = render({
      show: true,
      options: { title: 'Go', defaultValue: 'test-value', onSubmit, onCancel: vi.fn() }
    })
    const input = container.querySelector('input')!
    act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
    expect(onSubmit).toHaveBeenCalledWith('test-value')
  })

  it('Escape key triggers onCancel', () => {
    const onCancel = vi.fn()
    const { container } = render({
      show: true,
      options: { title: 'Go', onSubmit: vi.fn(), onCancel }
    })
    const input = container.querySelector('input')!
    act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('OK button calls onSubmit with current value', () => {
    const onSubmit = vi.fn()
    const { container } = render({
      show: true,
      options: { title: 'Go', defaultValue: 'ok-value', onSubmit, onCancel: vi.fn() }
    })
    const okBtn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'OK')!
    act(() => { okBtn.click() })
    expect(onSubmit).toHaveBeenCalledWith('ok-value')
  })
})
