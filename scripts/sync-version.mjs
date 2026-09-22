
import { readFileSync, writeFileSync } from 'node:fs'

const { version } = JSON.parse(readFileSync('package.json', 'utf8'))

for (const [file, pattern, replacement] of [
  ['src-tauri/Cargo.toml', /^version = ".*"$/m, `version = "${version}"`],
  ['src-tauri/tauri.conf.json', /"version": ".*"/, `"version": "${version}"`],

  [
    'src-tauri/Cargo.lock',
    /(\[\[package\]\]\nname = "patty"\nversion = )".*"/,
    `$1"${version}"`
  ]
]) {
  const text = readFileSync(file, 'utf8')
  if (!pattern.test(text)) throw new Error(`version field not found in ${file}`)
  writeFileSync(file, text.replace(pattern, replacement))
  console.log(`${file} -> ${version}`)
}
