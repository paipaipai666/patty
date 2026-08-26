import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

// REVIEW.md P1-7 — theme background color has FOUR hand-maintained sources:
//   1. src/renderer/themes/*.json        (runtime truth, applied by applyTheme)
//   2. src/renderer/styles/variables.css (:root + :root[data-theme=...] blocks,
//      the no-flash fallback painted before JS runs)
//   3. src-tauri/src/lib.rs BUILTIN      (native window background at startup)
//   4. src/renderer/index.html           (boot splash var(--patty-boot-bg, #hex))
// New/renamed themes must update all of them; a missed one shows as a flash of
// the wrong color at launch. This test fails on ANY drift between sources.
//
// Known live drift at introduction: variables.css :root says #000000 while
// themes/dark.json says #0a0a0c.

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

function readVariablesCss(): Record<string, string> {
  const css = readFileSync(join(ROOT, 'src', 'renderer', 'styles', 'variables.css'), 'utf8')
  const out: Record<string, string> = {}
  // :root { ... } is the dark (default) theme fallback; it has no data-theme
  // attribute, so it must not be confused with :root[data-theme="..."].
  for (const m of css.matchAll(/:root\[data-theme="([a-z-]+)"\]\s*\{([^}]*)\}/g)) {
    const bg = /--bg-app:\s*(#[0-9a-fA-F]{6})/.exec(m[2])
    if (bg) out[m[1]] = bg[1]
  }
  const rootBlock = /(?:^|\n):root\s*\{([^}]*)\}/.exec(css)
  if (rootBlock) {
    const bg = /--bg-app:\s*(#[0-9a-fA-F]{6})/.exec(rootBlock[1])
    if (bg) out['dark'] = bg[1]
  }
  return out
}

function readRustBuiltin(): Record<string, string> {
  const src = readFileSync(join(ROOT, 'src-tauri', 'src', 'lib.rs'), 'utf8')
  // Note: the const's type annotation itself contains ';' — scan to the
  // array's closing bracket instead of the first semicolon.
  const block = /const BUILTIN[\s\S]*?\];/.exec(src)
  const out: Record<string, string> = {}
  if (block) {
    for (const m of block[0].matchAll(/\("([a-z-]+)",\s*"(#[0-9a-fA-F]{6})"\)/g)) {
      out[m[1]] = m[2]
    }
  }
  return out
}

describe('theme --bg-app single-source consistency (REVIEW P1-7)', () => {
  const themes = readThemesJson()
  const css = readVariablesCss()
  const rust = readRustBuiltin()

  it('scanned all sources (sanity: the test is not vacuously green)', () => {
    expect(Object.keys(themes).sort()).toEqual([
      'dark',
      'dracula',
      'light',
      'nord',
      'solarized-light',
      'tokyo-night'
    ])
    // variables.css and lib.rs must cover every built-in theme.
    expect(Object.keys(css).sort()).toEqual(Object.keys(themes).sort())
    expect(Object.keys(rust).sort()).toEqual(Object.keys(themes).sort())
  })

  it('variables.css fallback matches themes/*.json', () => {
    for (const [id, bg] of Object.entries(themes)) {
      expect(css[id], `variables.css ${id === 'dark' ? ':root' : `[data-theme="${id}"]`}`).toBe(bg)
    }
  })

  it('lib.rs BUILTIN matches themes/*.json', () => {
    for (const [id, bg] of Object.entries(themes)) {
      expect(rust[id], `lib.rs BUILTIN "${id}"`).toBe(bg)
    }
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
