import { describe, it, expect, beforeAll, vi } from 'vitest'
import {
  BUILTIN_THEMES,
  DARK_UI,
  DARK_XTERM,
  UI_COLOR_LABELS,
  XTERM_COLOR_LABELS,
  getThemeColors,
  applyTheme,
  applyFontSettings,
  createDefaultCustomTheme
} from './themes'
import type { CustomTheme } from '../../shared/settingsTypes'

beforeAll(() => {
  const styleMap = new Map<string, string>()
  const mockDoc = {
    documentElement: {
      style: {
        setProperty: vi.fn((key: string, value: string) => { styleMap.set(key, value) }),
        removeProperty: vi.fn((key: string) => { styleMap.delete(key) })
      },
      dataset: {}
    }
  } as any
  vi.stubGlobal('document', mockDoc)
})

describe('BUILTIN_THEMES', () => {
  it('includes all expected themes', () => {
    expect(Object.keys(BUILTIN_THEMES).sort()).toEqual([
      'dark', 'dracula', 'light', 'nord', 'solarized-light', 'tokyo-night'
    ])
  })

  it('each theme has ui and terminal properties', () => {
    for (const key of Object.keys(BUILTIN_THEMES)) {
      const theme = BUILTIN_THEMES[key]
      expect(theme.ui).toBeDefined()
      expect(theme.terminal).toBeDefined()
      expect(theme.name).toBeDefined()
    }
  })
})

describe('getThemeColors', () => {
  it('returns dark theme for a built-in key', () => {
    const { ui, terminal } = getThemeColors('dark')
    expect(ui['--bg-app']).toBeDefined()
    expect(terminal.background).toBeDefined()
    expect(ui['--bg-app']).toBe(DARK_UI['--bg-app'])
  })

  it('returns light theme for light key', () => {
    const { ui } = getThemeColors('light')
    expect(ui['--bg-app']).toBeDefined()
  })

  it('returns custom theme when id matches', () => {
    const custom: CustomTheme = {
      id: 'my-theme',
      name: 'My Theme',
      ui: { '--bg-app': '#ff0000' } as any,
      terminal: { background: '#00ff00' } as any
    }
    const { ui, terminal } = getThemeColors('my-theme', [custom])
    expect(ui['--bg-app']).toBe('#ff0000')
    expect(terminal.background).toBe('#00ff00')
  })

  it('falls back to dark defaults for unknown theme', () => {
    const { ui, terminal } = getThemeColors('nonexistent')
    expect(ui['--bg-app']).toBe(DARK_UI['--bg-app'])
    expect(terminal.background).toBe(DARK_XTERM.background)
  })

  it('custom theme merges over UI defaults', () => {
    const custom: CustomTheme = {
      id: 'partial',
      name: 'Partial',
      ui: { '--bg-app': '#111111' } as any,
      terminal: {} as any
    }
    const { ui, terminal } = getThemeColors('partial', [custom])
    expect(ui['--bg-app']).toBe('#111111')
    expect(terminal.background).toBe(DARK_XTERM.background)
  })
})

describe('applyTheme', () => {
  it('sets CSS properties on documentElement', () => {
    applyTheme('dark')
    expect(document.documentElement.style.setProperty).toHaveBeenCalled()
  })

  it('does not re-set unchanged properties (cache)', () => {
    vi.clearAllMocks()
    applyTheme('dark')
    const callsAfterCache = (document.documentElement.style.setProperty as any).mock.calls.length
    applyTheme('dark')
    // Second call should find everything cached and do nothing
    expect((document.documentElement.style.setProperty as any).mock.calls.length).toBe(callsAfterCache)
  })


})

describe('applyFontSettings', () => {
  it('sets font-family and font-size CSS properties', () => {
    applyFontSettings('Cascadia Code', 16)
    expect(document.documentElement.style.setProperty).toHaveBeenCalledWith(
      '--font-mono',
      "'Cascadia Code', Consolas, 'Courier New', monospace"
    )
    expect(document.documentElement.style.setProperty).toHaveBeenCalledWith(
      '--font-size-term',
      '16px'
    )
  })
})

describe('createDefaultCustomTheme', () => {
  it('creates a theme with dark defaults', () => {
    const theme = createDefaultCustomTheme('My Theme')
    expect(theme.name).toBe('My Theme')
    expect(theme.id).toMatch(/^custom-/)
    expect(theme.ui['--bg-app']).toBe(DARK_UI['--bg-app'])
    expect(theme.terminal.background).toBe(DARK_XTERM.background)
  })
})

describe('color labels', () => {
  it('UI_COLOR_LABELS has entries for all UI theme keys', () => {
    for (const key of Object.keys(DARK_UI)) {
      expect(UI_COLOR_LABELS[key as keyof typeof UI_COLOR_LABELS]).toBeDefined()
    }
  })

  it('XTERM_COLOR_LABELS has entries for all xterm theme keys', () => {
    for (const key of Object.keys(DARK_XTERM)) {
      expect(XTERM_COLOR_LABELS[key as keyof typeof XTERM_COLOR_LABELS]).toBeDefined()
    }
  })
})
