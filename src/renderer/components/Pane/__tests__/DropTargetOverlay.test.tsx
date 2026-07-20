import { describe, it, expect } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { DropTargetOverlay } from '../DropTargetOverlay'

function render(zone: unknown) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => { root.render(<DropTargetOverlay zone={zone as any} />) })
  return { container, root }
}

describe('DropTargetOverlay', () => {
  it('renders null when zone is null', () => {
    const { container } = render(null)
    expect(container.innerHTML).toBe('')
  })

  it.each(['left', 'right', 'top', 'bottom', 'center'] as const)('renders a div when zone is %s', (zone) => {
    const { container } = render(zone)
    const div = container.querySelector('div[aria-hidden="true"]')
    expect(div).not.toBeNull()
  })

  it('renders nothing for undefined zone', () => {
    const { container } = render(undefined)
    expect(container.innerHTML).toBe('')
  })
})
