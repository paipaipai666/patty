import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { Dropdown } from '../../App/Dropdown'

// Interaction contract for the shared dropdown: listbox semantics, keyboard
// navigation, mouse selection, click-outside dismissal.

const OPTIONS = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Beta' },
  { value: 'c', label: 'Gamma' }
]

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>
let onSelect: Mock<(value: string, mouse?: { x: number; y: number }) => void>

beforeEach(() => {
  ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
  onSelect = vi.fn<(value: string, mouse?: { x: number; y: number }) => void>()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root.render(
      <Dropdown value="a" options={OPTIONS} onSelect={onSelect} ariaLabel="Test dropdown" />
    )
  })
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function input(): HTMLInputElement {
  return container.querySelector('input')!
}

function keydown(key: string) {
  act(() => {
    input().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
  })
}

describe('Dropdown', () => {
  it('closed control shows the selected label and exposes combobox semantics', () => {
    expect(input().value).toBe('Alpha')
    expect(input().getAttribute('role')).toBe('combobox')
    expect(input().getAttribute('aria-expanded')).toBe('false')
  })

  it('opens on click and renders options as listbox/option', () => {
    act(() => {
      input().dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    const list = container.querySelector('[role="listbox"]')
    expect(list).not.toBeNull()
    expect(container.querySelectorAll('[role="option"]')).toHaveLength(3)
    expect(input().getAttribute('aria-expanded')).toBe('true')
  })

  it('keyboard: ArrowDown moves active, Enter selects', () => {
    keydown('ArrowDown') // opens
    keydown('ArrowDown') // active → Beta
    keydown('Enter')
    expect(onSelect).toHaveBeenCalledWith('b', undefined)
    // closed again
    expect(container.querySelector('[role="listbox"]')).toBeNull()
  })

  it('keyboard: Escape closes without selecting', () => {
    keydown('ArrowDown')
    keydown('Escape')
    expect(onSelect).not.toHaveBeenCalled()
    expect(container.querySelector('[role="listbox"]')).toBeNull()
  })

  it('mouse: mousedown selects with click coordinates', () => {
    act(() => {
      input().dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    const option = container.querySelectorAll('[role="option"]')[2]
    act(() => {
      option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 40, clientY: 30 }))
    })
    expect(onSelect).toHaveBeenCalledWith('c', { x: 40, y: 30 })
  })

  it('click outside closes the list', () => {
    act(() => {
      input().dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    act(() => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })
    expect(container.querySelector('[role="listbox"]')).toBeNull()
  })

  it('searchable: typing filters options by label', () => {
    act(() => {
      root.render(
        <Dropdown value="a" options={OPTIONS} onSelect={onSelect} ariaLabel="Test" searchable />
      )
    })
    act(() => {
      input().dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    act(() => {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
      nativeInputValueSetter.call(input(), 'gam')
      input().dispatchEvent(new Event('input', { bubbles: true }))
    })
    const options = container.querySelectorAll('[role="option"]')
    expect(options).toHaveLength(1)
    expect(options[0].textContent).toBe('Gamma')
  })
})
