import { describe, expect, it } from 'vitest'
import { getThemeColors } from '../themes'

function luminance(hex: string): number {
  expect(hex).toMatch(/^#[0-9a-f]{6}$/i)
  const channels = [1, 3, 5].map((index) => {
    const value = parseInt(hex.slice(index, index + 2), 16) / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
}

function contrast(foreground: string, background: string): number {
  const values = [luminance(foreground), luminance(background)].sort(
    (a, b) => b - a
  )
  return (values[0] + 0.05) / (values[1] + 0.05)
}

describe.each(['dark', 'light'])('Graphite %s contrast', (theme) => {
  const { ui, terminal } = getThemeColors(theme)

  it('keeps session text and status labels readable on normal and selected rows', () => {
    for (const foreground of [
      '--text-primary',
      '--text-secondary',
      '--amber',
      '--green',
      '--red'
    ] as const) {
      for (const background of ['--bg-sidebar', '--bg-item-active'] as const) {
        expect(
          contrast(ui[foreground], ui[background]),
          `${foreground} on ${background}`
        ).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it('keeps input hints, primary actions and terminal text readable', () => {
    expect(
      contrast(ui['--text-muted'], ui['--bg-input'])
    ).toBeGreaterThanOrEqual(4.5)
    expect(
      contrast(ui['--btn-active-text'], ui['--accent'])
    ).toBeGreaterThanOrEqual(4.5)
    expect(
      contrast(terminal.foreground, terminal.background)
    ).toBeGreaterThanOrEqual(4.5)
  })
})
