/**
 * Sentinel for the WebGL atlas-merge workaround in TerminalPane.tsx.
 *
 * startAtlasGuard reads addon-webgl internals (`_renderer._charAtlas._pages`)
 * and calls `clearTextureAtlas()` to keep the texture atlas below the page
 * count that triggers the buggy 4→1 merge in @xterm/addon-webgl@0.18.0. The
 * internals are private: if an addon upgrade renames them, the guard silently
 * stops protecting (its comment documents this failure mode). This test makes
 * that failure loud by asserting, against the INSTALLED package, that:
 *   1. the version is still the 0.18.x line the guard was written for, and
 *   2. the private field names the guard walks still exist in the bundle.
 *
 * If this fails after a dependency bump: check whether the atlas merge bug is
 * fixed upstream; if yes, delete startAtlasGuard and this sentinel; if no,
 * re-verify the field names and adjust the guard.
 */
import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const entry = require.resolve('@xterm/addon-webgl')
const pkgDir = dirname(dirname(entry)) // …/@xterm/addon-webgl/lib/addon-webgl.js → package root

function* jsFiles(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      yield* jsFiles(path)
    } else if (name.endsWith('.js')) {
      yield path
    }
  }
}

const bundle = [...jsFiles(join(pkgDir, 'lib'))]
  .map((f) => readFileSync(f, 'utf8'))
  .join('\n')

describe('atlas guard sentinel (@xterm/addon-webgl)', () => {
  it('is pinned to the 0.18.x line the workaround was written against', () => {
    const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'))
    expect(
      pkg.version,
      `addon-webgl bumped to ${pkg.version}: re-verify the atlas-merge workaround (see TerminalPane.tsx startAtlasGuard)`
    ).toMatch(/^0\.18\./)
  })

  it('still exposes the private atlas fields the guard walks', () => {
    expect(bundle).toContain('_charAtlas')
    expect(bundle).toContain('_pages')
  })

  it('still exposes clearTextureAtlas (the guard action)', () => {
    expect(bundle).toContain('clearTextureAtlas')
  })
})
