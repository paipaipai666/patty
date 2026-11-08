import { mkdir, writeFile, copyFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const repository = resolve(here, '../..')
const output = join(repository, 'output/omp-standard')
const standalone = process.argv.includes('--standalone')
await mkdir(join(output, 'profile'), { recursive: true })
const stamp = new Date().toISOString()
const fixture = join(output, 'fixed-session.jsonl')
const assistant = (id, parentId, content, timestamp) => ({ type: 'message', id, parentId, timestamp: stamp,
  message: { role: 'assistant', timestamp, api: 'anthropic-messages', provider: 'anthropic', model: 'fixture', stopReason: 'stop',
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    content } })
await writeFile(fixture, [
  { type: 'session', version: 3, id: 'omp-standard-probe', cwd: output, timestamp: stamp },
  { type: 'message', id: 'first-user', parentId: null, timestamp: stamp, message: { role: 'user', content: 'OMP_STANDARD_FIRST_QUESTION', timestamp: 1 } },
  assistant('first-assistant', 'first-user', [{ type: 'thinking', thinking: 'Probe thinking text' }, { type: 'text', text: 'OMP_STANDARD_FIRST_ANSWER' }], 2),
  assistant('first-tool', 'first-assistant', [{ type: 'toolCall', id: 'probe-call', name: 'read', arguments: { path: 'README.md' } }], 3),
  { type: 'message', id: 'first-result', parentId: 'first-tool', timestamp: stamp, message: { role: 'toolResult', toolCallId: 'probe-call', toolName: 'read', content: [{ type: 'text', text: 'Probe tool result text' }], isError: false, timestamp: 4 } },
  { type: 'message', id: 'second-user', parentId: 'first-result', timestamp: stamp, message: { role: 'user', content: 'OMP_STANDARD_LIVE_TAIL', timestamp: 5 } },
].map(value => JSON.stringify(value)).join('\n') + '\n')
let extension = join(here, 'standard-probe.ts')
if (standalone) { extension = join(output, 'standard-probe.ts'); await copyFile(join(here, 'standard-probe.ts'), extension) }
const result = spawnSync(join(process.env.USERPROFILE ?? '', '.bun/bin/omp.exe'), [
  '--resume', fixture, '--no-extensions', '--extension', extension, '--no-rules', '--no-skills', '--no-context-files', '--no-tools', '--no-lsp', '--no-title', '--cwd', output,
], {
  cwd: output, stdio: 'inherit', timeout: 45000, windowsHide: true,
  env: { ...process.env, PI_CODING_AGENT_DIR: join(output, 'profile'), OMP_STANDARD_REPORT: join(output, standalone ? 'standalone-report.json' : 'report.json') },
})
if (result.error) throw result.error
process.exitCode = result.status ?? 1
