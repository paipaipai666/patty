import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_SETTINGS } from '../defaultSettings'

// REVIEW.md P1-8a — the settings schema is maintained twice by hand:
// src-tauri/src/store.rs `default_settings()` (which also serves as the
// settings_set whitelist: keys absent from it are rejected) and
// src/shared/defaultSettings.ts `DEFAULT_SETTINGS`. Drift is silent: a
// TS-only key makes every settingsSet for it fail; a Rust-only key never
// reaches the renderer's initial state.
//
// This test parses the Rust json! literal out of store.rs and requires exact
// parity with the TS defaults. Guard, not bug repro — the two sides are in
// sync today, and this keeps them that way.

const STORE_RS = join(__dirname, '..', '..', '..', 'src-tauri', 'src', 'store.rs')

/** Extract the json!({...}) literal of `pub fn default_settings` from Rust source. */
function extractRustDefaults(src: string): unknown {
  const fnStart = src.indexOf('pub fn default_settings()')
  expect(fnStart, 'default_settings() found in store.rs').toBeGreaterThanOrEqual(0)
  const jsonStart = src.indexOf('json!(', fnStart)
  expect(jsonStart).toBeGreaterThanOrEqual(0)
  // Balanced-paren scan, string-aware (values like "Ctrl+T" contain no parens,
  // but stay correct if they ever do).
  let depth = 0
  let inString = false
  let escaped = false
  const open = src.indexOf('(', jsonStart + 5)
  for (let i = open; i < src.length; i++) {
    const ch = src[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '(') depth++
    else if (ch === ')') {
      depth--
      if (depth === 0) {
        const literal = src.slice(open + 1, i)
        return JSON.parse(literal)
      }
    }
  }
  throw new Error('unbalanced json!() literal in store.rs')
}

describe('settings defaults parity: Rust store.rs ↔ TS defaultSettings.ts (REVIEW P1-8a)', () => {
  it('both sides define exactly the same defaults', () => {
    const rust = extractRustDefaults(readFileSync(STORE_RS, 'utf8'))
    expect(rust).toEqual(DEFAULT_SETTINGS)
  })
})
