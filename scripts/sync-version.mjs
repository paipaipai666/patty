// Syncs package.json version into the Rust/Tauri manifests. Runs via the npm
// "version" lifecycle script, so `npm run version:patch|minor|major` updates
// all three files in one step.
import { readFileSync, writeFileSync } from 'node:fs'

const { version } = JSON.parse(readFileSync('package.json', 'utf8'))

for (const [file, pattern, replacement] of [
  ['src-tauri/Cargo.toml', /^version = ".*"$/m, `version = "${version}"`],
  ['src-tauri/tauri.conf.json', /"version": ".*"/, `"version": "${version}"`]
]) {
  const text = readFileSync(file, 'utf8')
  if (!pattern.test(text)) throw new Error(`version field not found in ${file}`)
  writeFileSync(file, text.replace(pattern, replacement))
  console.log(`${file} -> ${version}`)
}
