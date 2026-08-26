import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

// REVIEW.md P0-2 — IPC event producer/consumer contract.
//
// The renderer subscribes to backend events by name in api.ts; the Rust side
// emits them with plain string literals / format! templates. There is no
// shared constant or schema, so a name that exists on only one side degrades
// silently (Tauri drops events with no listener; a listener with no producer
// simply never fires).
//
// Known live case: api.ts onPtyExit listens on the bare 'pty:exit' event, but
// the backend only ever emits 'pty:exit:{id}' (pty.rs wait_loop,
// sshconn.rs read loop) — the attention/aiType cleanup registered through
// onPtyExit has never fired.
//
// This test scans both sides and requires every renderer-listened event to
// have at least one Rust emit site. Dynamic segments are normalized:
//   `pty:data:${id}`  →  pty:data:*     (renderer template literal)
//   "pty:data:{id}"   →  pty:data:*     (Rust format! named capture)
//   "pty:data:{}"     →  pty:data:*     (Rust format! positional)

const ROOT = join(__dirname, '..', '..', '..')

function normalizeEventName(name: string): string {
  return name.replace(/\$\{[^}]*\}/g, '*').replace(/\{[a-zA-Z_]*\}/g, '*')
}

/** Event names the renderer listens on, from src/renderer/api.ts. */
function rendererListenedEvents(): string[] {
  const src = readFileSync(join(ROOT, 'src/renderer/api.ts'), 'utf8')
  const events: string[] = []
  for (const m of src.matchAll(/listen(?:<[^>]*>)?\(\s*(['`])((?:\\.|(?!\1).)*?)\1/g)) {
    events.push(m[2])
  }
  return events
}

/** Event names the Rust backend emits, from src-tauri/src/*.rs. */
function rustEmittedEvents(): string[] {
  const dir = join(ROOT, 'src-tauri', 'src')
  const events = new Set<string>()
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.rs'))) {
    const src = readFileSync(join(dir, file), 'utf8')
    const patterns = [
      // app.emit("name", ...) / app.emit(&format!("name:{id}"), ...)
      /\.emit\(\s*(?:&?format!\(\s*)?"([^"]+)"/g,
      // emit(&app, "name", ...) / emit(app, "name", ...) /
      // emit(&loop_app, &format!("name:{id}"), ...)  — the pty/sshconn helper
      /[^.]\bemit\(\s*&?[a-z_.]+\s*,\s*(?:&?format!\(\s*)?"([^"]+)"/gi
    ]
    for (const re of patterns) {
      for (const m of src.matchAll(re)) {
        // Keep only plausible event names (filters out error-message format!
        // strings and other literals that happen to sit near an emit call).
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

    // Sanity: the scan must actually find the known channels, or the test
    // would pass vacuously.
    expect(listened.length).toBeGreaterThanOrEqual(7)
    expect(emitted.has('pty:data:*')).toBe(true)
    expect(emitted.has('pty:exit:*')).toBe(true)
    expect(emitted.has('pty:attn')).toBe(true)

    const orphans = listened.filter((name) => !emitted.has(name))
    // DESIRED: no orphan listeners. Currently contains 'pty:exit' — the bare
    // event onPtyExit waits on, which no backend code path ever emits
    // (only 'pty:exit:*' exists). Fails until the backend also emits a global
    // 'pty:exit' or the renderer subscribes per-session instead.
    expect(orphans).toEqual([])
  })
})
