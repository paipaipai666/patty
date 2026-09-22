
   
import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const entry = require.resolve('@xterm/addon-webgl')
const pkgDir = dirname(dirname(entry))

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
