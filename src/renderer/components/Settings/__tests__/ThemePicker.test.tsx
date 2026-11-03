import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ThemePicker } from '../ThemePicker'
import { DARK_UI, DARK_XTERM } from '../../../styles/themes'
import type { CustomTheme } from '../../../../shared/settingsTypes'

let root: ReturnType<typeof createRoot>
let container: HTMLDivElement
const changes = vi.fn<(id: string) => void>()

beforeEach(() => {
  changes.mockClear()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => { act(() => root.unmount()); container.remove() })

function Picker({ customThemes = [] }: { customThemes?: CustomTheme[] }) {
  const [theme, setTheme] = useState('dark')
  return <ThemePicker value={theme} customThemes={customThemes} onChange={id => { changes(id); setTheme(id) }} />
}

function radio(name: string): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>(`input[aria-label="${name}"]`)
  if (!input) throw new Error(`Missing theme ${name}`)
  return input
}

describe('theme thumbnails', () => {
  it('groups all six built-in themes by appearance and identifies the current one', () => {
    act(() => root.render(<Picker />))
    expect(Array.from(container.querySelectorAll('h3')).map(heading => heading.textContent)).toEqual(['Dark themes', 'Light themes'])
    expect(Array.from(container.querySelectorAll('input[type="radio"]')).map(input => input.getAttribute('aria-label')).sort()).toEqual(['Dark', 'Dracula', 'Light', 'Nord', 'Solarized Light', 'Tokyo Night'])
    expect(radio('Dark').checked).toBe(true)
    expect(radio('Dark').closest('label')?.textContent).toContain('Current')
    expect(container.querySelectorAll('[data-testid="theme-thumbnail"]')).toHaveLength(6)
  })

  it('does not apply a theme on hover and selects a different theme exactly once', () => {
    act(() => root.render(<Picker />))
    act(() => radio('Light').closest('label')?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })))
    expect(changes).not.toHaveBeenCalled()
    act(() => radio('Light').click())
    expect(changes.mock.calls).toEqual([['light']])
    expect(radio('Light').checked).toBe(true)
    expect(radio('Dark').checked).toBe(false)
    expect(radio('Light').closest('label')?.textContent).toContain('Current')
    act(() => radio('Light').click())
    expect(changes).toHaveBeenCalledOnce()
  })

  it('uses a custom theme palette in its miniature and selects its original ID', () => {
    const custom: CustomTheme = { id: 'personal-theme', name: 'Personal', ui: { ...DARK_UI, '--bg-sidebar': '#224466' }, terminal: { ...DARK_XTERM, background: '#112233' } }
    act(() => root.render(<Picker customThemes={[custom]} />))
    expect(Array.from(container.querySelectorAll('h3')).map(heading => heading.textContent)).toContain('Custom themes')
    const preview = radio('Personal').closest('label')?.querySelector<HTMLElement>('[data-testid="theme-thumbnail"]')
    expect(preview?.style.getPropertyValue('--thumbnail-sidebar')).toBe('#224466')
    expect(preview?.style.getPropertyValue('--thumbnail-terminal')).toBe('#112233')
    act(() => radio('Personal').click())
    expect(changes.mock.calls).toEqual([['personal-theme']])
    expect(radio('Personal').checked).toBe(true)
  })

  it('keeps previews decorative and uses one native radio group for keyboard navigation', () => {
    act(() => root.render(<Picker />))
    expect(container.querySelector('legend')?.textContent).toBe('Color theme')
    expect(new Set(Array.from(container.querySelectorAll('input')).map(input => input.name)).size).toBe(1)
    expect(Array.from(container.querySelectorAll('[data-testid="theme-thumbnail"]')).every(preview => preview.getAttribute('aria-hidden') === 'true')).toBe(true)
    expect(container.querySelector('[role="combobox"]')).toBeNull()
  })
})
