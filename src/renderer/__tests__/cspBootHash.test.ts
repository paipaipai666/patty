import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'



const INDEX_HTML = join(__dirname, '..', 'index.html')

function extractInlineScripts(html: string): string[] {

  return [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1])
}

describe('index.html CSP hash guards the boot script (REVIEW P1-11)', () => {
  it('script-src sha256 matches the inline boot script content', () => {
    const html = readFileSync(INDEX_HTML, 'utf8')

    const metaTag = /<meta[^>]*http-equiv="Content-Security-Policy"[^>]*>/s.exec(html)
    const csp = metaTag && /content="([^"]+)"/s.exec(metaTag[0])
    expect(csp, 'CSP meta tag present').not.toBeNull()
    const hashes = [...csp![1].matchAll(/'sha256-([^']+)'/g)].map((m) => m[1])
    const scripts = extractInlineScripts(html)
    expect(scripts.length).toBeGreaterThan(0)

    const actual = scripts.map((s) => createHash('sha256').update(s, 'utf8').digest('base64'))
    for (const h of hashes) {
      expect(
        actual,
        'every CSP-listed script hash must correspond to an inline script (edit the boot script → recompute the hash)'
      ).toContain(h)
    }
    for (const a of actual) {
      expect(
        hashes,
        'every inline script must be covered by the CSP hash list'
      ).toContain(a)
    }
  })
})
