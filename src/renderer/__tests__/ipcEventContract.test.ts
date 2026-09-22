import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'



const ROOT = join(__dirname, '..', '..', '..')

function normalizeEventName(name: string): string {
  return name.replace(/\$\{[^}]*\}/g, '*').replace(/\{[a-zA-Z_]*\}/g, '*')
}

                                                                     
function rendererListenedEvents(): string[] {
  const src = readFileSync(join(ROOT, 'src/renderer/api.ts'), 'utf8')
  const events: string[] = []
  for (const m of src.matchAll(/listen(?:<[^>]*>)?\(\s*(['`])((?:\\.|(?!\1).)*?)\1/g)) {
    events.push(m[2])
  }
  return events
}

                                                                   
function rustEmittedEvents(): string[] {
  const dir = join(ROOT, 'src-tauri', 'src')
  const events = new Set<string>()
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.rs'))) {
    const src = readFileSync(join(dir, file), 'utf8')
    const patterns = [

      /\.emit\(\s*(?:&?format!\(\s*)?"([^"]+)"/g,

      /[^.]\bemit\(\s*&?[a-z_.]+\s*,\s*(?:&?format!\(\s*)?"([^"]+)"/gi
    ]
    for (const re of patterns) {
      for (const m of src.matchAll(re)) {

        if (/^(pty|ssh|metrics|hooks):[a-z0-9_:{}*-]*$/i.test(m[1])) {
          events.add(m[1])
        }
      }
    }
  }
  return [...events]
}

describe('IPC event contract (renderer listeners ↔ Rust emitters)', () => {
  it('every event the renderer listens to is emitted somewhere in Rust', () => {
    const listened = rendererListenedEvents().map(normalizeEventName)
    const emitted = new Set(rustEmittedEvents().map(normalizeEventName))


    expect(listened.length).toBeGreaterThanOrEqual(7)
    expect(emitted.has('pty:data:*')).toBe(true)
    expect(emitted.has('pty:exit:*')).toBe(true)
    expect(emitted.has('pty:attn')).toBe(true)

    const orphans = listened.filter((name) => !emitted.has(name))

    expect(orphans).toEqual([])
  })
})
