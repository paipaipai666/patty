import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'

import { useToastStore } from '../../../store/toastStore'
import { Toasts } from '../Toasts'

function render() {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => { root.render(<Toasts />) })
  return { container, root }
}

describe('Toasts', () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] })
    document.body.innerHTML = ''
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('renders null when there are no toasts', () => {
    const { container } = render()
    expect(container.innerHTML).toBe('')
  })

  it('renders toasts from the store', () => {
    act(() => {
      useToastStore.setState({
        toasts: [
          { id: 1, message: 'File saved', kind: 'info' },
          { id: 2, message: 'Connection lost', kind: 'error' }
        ]
      })
    })
    const { container } = render()
    const alerts = container.querySelectorAll('[role="alert"]')
    expect(alerts).toHaveLength(2)
    expect(alerts[0].textContent).toBe('File saved')
    expect(alerts[1].textContent).toBe('Connection lost')
  })

  it('clicking a toast dismisses it', () => {
    act(() => {
      useToastStore.setState({
        toasts: [
          { id: 42, message: 'Dismiss me', kind: 'info' }
        ]
      })
    })
    const dismissSpy = vi.spyOn(useToastStore.getState(), 'dismiss')
    const { container } = render()
    const alert = container.querySelector('[role="alert"]')!
    act(() => { alert.click() })
    expect(dismissSpy).toHaveBeenCalledWith(42)
    dismissSpy.mockRestore()
  })

  it('error toasts have error styling class', () => {
    act(() => {
      useToastStore.setState({
        toasts: [
          { id: 1, message: 'Error!', kind: 'error' }
        ]
      })
    })
    const { container } = render()
    const alert = container.querySelector('[role="alert"]')!
    expect(alert.className).toContain('toastError')
  })
})
