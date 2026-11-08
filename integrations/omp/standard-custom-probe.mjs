import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const output = resolve(here, '../../output/omp-standard-custom')
await mkdir(join(output, 'profile'), { recursive: true })
const stamp = new Date().toISOString()
const fixture = join(output, 'standard-custom-probe-session.jsonl')
await writeFile(fixture, [
  { type: 'session', version: 3, id: 'omp-standard-custom-probe', cwd: output, timestamp: stamp },
  { type: 'message', id: 'first-user', parentId: null, timestamp: stamp, message: { role: 'user', content: 'STANDARD_CUSTOM_FIRST_QUESTION', timestamp: 1 } },
  { type: 'message', id: 'last-user', parentId: 'first-user', timestamp: stamp, message: { role: 'user', content: 'STANDARD_CUSTOM_LIVE_TAIL', timestamp: 2 } }
].map(value => JSON.stringify(value)).join('\n') + '\n')
const result = spawnSync(join(process.env.USERPROFILE ?? '', '.bun/bin/omp.exe'), [
  '--resume', fixture, '--no-extensions', '--extension', join(here, 'standard-custom-probe.ts'), '--no-rules', '--no-skills', '--no-context-files', '--no-tools', '--no-lsp', '--no-title', '--cwd', output
], { cwd: output, stdio: 'inherit', timeout: 15000, windowsHide: true, env: { ...process.env, PI_CODING_AGENT_DIR: join(output, 'profile'), OMP_STANDARD_CUSTOM_REPORT: join(output, 'standard-custom-probe-report.json') } })
if (result.error) throw result.error
process.exitCode = result.status ?? 1
