import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

// REVIEW.md P1-7 — theme background color used to have FOUR hand-maintained
// sources (themes/*.json, variables.css data-theme blocks, lib.rs BUILTIN,
// index.html boot splash). After the C2 single-sourcing:
//   - themes/*.json is the only per-theme truth;
//   - lib.rs embeds the JSONs via include_str! (compile time);
//   - the pre-JS paint comes from the localStorage cache written by
//     settingsStore (main.tsx), not from stylesheet fallback blocks;
//   - variables.css :root and the index.html splash fallback only ever carry
//     the DEFAULT (dark) theme.
// This test pins that structure so the duplication can't creep back.

const ROOT = join(__dirname, '..', '..', '..', '..')

function readThemesJson(): Record<string, string> {
  const dir = join(ROOT, 'src', 'renderer', 'themes')
  const out: Record<string, string> = {}
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    const theme = JSON.parse(readFileSync(join(dir, file), 'utf8'))
    // Theme files have no id field — the filename is the id (dark.json → dark).
    out[file.replace(/\.json$/, '')] = theme.ui['--bg-app']
  }
  return out
}

const themes = readThemesJson()
const THEME_IDS = ['dark', 'dracula', 'light', 'nord', 'solarized-light', 'tokyo-night']

describe('theme single-source structure (REVIEW P1-7)', () => {
  it('scans all built-in themes (sanity)', () => {
    expect(Object.keys(themes).sort()).toEqual(THEME_IDS)
  })

  it('variables.css has no per-theme data-theme blocks (deleted in favor of the boot cache)', () => {
    const css = readFileSync(join(ROOT, 'src', 'renderer', 'styles', 'variables.css'), 'utf8')
    expect(css.includes('[data-theme=')).toBe(false)
  })

  it('variables.css :root default matches themes/dark.json', () => {
    const css = readFileSync(join(ROOT, 'src', 'renderer', 'styles', 'variables.css'), 'utf8')
    const rootBlock = /(?:^|\n):root\s*\{([^}]*)\}/.exec(css)
    const bg = rootBlock && /--bg-app:\s*(#[0-9a-fA-F]{6})/.exec(rootBlock[1])
    expect(bg?.[1]).toBe(themes['dark'])
  })

  it('lib.rs embeds every theme JSON via include_str!', () => {
    const src = readFileSync(join(ROOT, 'src-tauri', 'src', 'lib.rs'), 'utf8')
    const embedded = [
      ...src.matchAll(/include_str!\("\.\.\/\.\.\/src\/renderer\/themes\/([a-z-]+)\.json"\)/g)
    ].map((m) => m[1])
    expect(embedded.sort()).toEqual(THEME_IDS)
    // And no hand-maintained hex table may return alongside it.
    expect(src.includes('const BUILTIN')).toBe(false)
  })

  it('index.html boot splash fallback matches dark theme', () => {
    const html = readFileSync(join(ROOT, 'src', 'renderer', 'index.html'), 'utf8')
    const fallbacks = [...html.matchAll(/var\(--patty-boot-bg,\s*(#[0-9a-fA-F]{6})\)/g)].map(
      (m) => m[1]
    )
    expect(fallbacks.length).toBeGreaterThan(0)
    for (const hex of fallbacks) {
      expect(hex).toBe(themes['dark'])
    }
  })
})
