import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

// REVIEW.md P1-11 — the CSP meta tag in index.html pins the inline boot script
// by hand-computed sha256. Editing the script without recomputing the hash
// silently disables the boot background paint (CSP blocks the script and the
// splash falls back to the default color). Nothing else guards this, so the
// failure mode is invisible until someone notices the flash.
//
// This test recomputes the hash from the actual script content and compares it
// against the CSP — the check that should always stay green.

const INDEX_HTML = join(__dirname, '..', 'index.html')

function extractInlineScripts(html: string): string[] {
  // Match <script> tags without src= and capture their content.
  return [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1])
}

describe('index.html CSP hash guards the boot script (REVIEW P1-11)', () => {
  it('script-src sha256 matches the inline boot script content', () => {
    const html = readFileSync(INDEX_HTML, 'utf8')
    // The meta tag spans multiple lines; match the whole tag first, then pull
    // the content attribute regardless of attribute order/whitespace.
    const metaTag = /<meta[^>]*http-equiv="Content-Security-Policy"[^>]*>/s.exec(html)
    const csp = metaTag && /content="([^"]+)"/s.exec(metaTag[0])
    expect(csp, 'CSP meta tag present').not.toBeNull()
    const hashes = [...csp![1].matchAll(/'sha256-([^']+)'/g)].map((m) => m[1])
    const scripts = extractInlineScripts(html)
    expect(scripts.length).toBeGreaterThan(0)
    // Bare digests on both sides (the CSP prefix 'sha256-' is stripped above).
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
