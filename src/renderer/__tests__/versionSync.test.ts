import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'


const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8')

describe('version sync', () => {
  it('package.json, tauri.conf.json and Cargo.toml report the same version', () => {
    const pkg = JSON.parse(read('package.json')).version
    const tauriConf = JSON.parse(read('src-tauri/tauri.conf.json')).version
    const cargo = read('src-tauri/Cargo.toml').match(/^version = "(.+)"$/m)?.[1]
    expect(tauriConf).toBe(pkg)
    expect(cargo).toBe(pkg)
  })
})
