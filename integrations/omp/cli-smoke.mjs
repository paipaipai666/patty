import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const project = resolve(here, '../..')
const workspace = join(project, 'output/omp-navigation')
const profile = join(workspace, 'profile')
await mkdir(profile, { recursive: true })
const fixture = join(workspace, 'cli-probe-session.jsonl')
const timestamp = new Date().toISOString()
await writeFile(fixture, [
  { type: 'session', version: 3, id: 'gate0-cli-probe', cwd: workspace, timestamp },
  { type: 'message', id: 'entry-000', parentId: null, timestamp, message: { role: 'user', content: 'OMP_NAV_QUESTION_000', timestamp: Date.now() } },
].map(value => JSON.stringify(value)).join('\n') + '\n')
const executable = join(workspace, 'runtime/bun-windows-x64/bun.exe')
const entry = join(workspace, 'node_modules/@oh-my-pi/pi-coding-agent/src/cli.ts')
const result = spawnSync(executable, [entry, '--resume', fixture, '--no-extensions', '--extension', join(here, 'cli-probe.ts'), '--no-rules', '--no-skills', '--no-context-files', '--no-tools', '--no-lsp', '--no-title', '--cwd', workspace], {
  cwd: workspace,
  stdio: 'inherit',
  timeout: 30000,
  env: { ...process.env, PI_CODING_AGENT_DIR: profile },
})
if (result.error) throw result.error
process.exitCode = result.status ?? 1
