import { readdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const tests = (await readdir(join(repository, 'integrations/omp'))).filter(name => name.endsWith('.test.ts')).sort()
const result = spawnSync(join(repository, 'output/omp-navigation/runtime/bun-windows-x64/bun.exe'),
  ['test', ...tests.map(name => join(repository, 'integrations/omp', name))],
  { cwd: repository, stdio: 'inherit', windowsHide: true, timeout: 120000 })
if (result.error) throw result.error
process.exitCode = result.status ?? 1
