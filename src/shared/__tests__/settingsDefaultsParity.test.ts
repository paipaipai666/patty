import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_SETTINGS } from '../defaultSettings'



const STORE_RS = join(__dirname, '..', '..', '..', 'src-tauri', 'src', 'store.rs')

                                                                                      
function extractRustDefaults(src: string): unknown {
  const fnStart = src.indexOf('pub fn default_settings()')
  expect(fnStart, 'default_settings() found in store.rs').toBeGreaterThanOrEqual(0)
  const jsonStart = src.indexOf('json!(', fnStart)
  expect(jsonStart).toBeGreaterThanOrEqual(0)

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
