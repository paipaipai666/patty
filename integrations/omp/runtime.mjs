import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../output/omp-navigation/runtime')
const url = 'https://github.com/oven-sh/bun/releases/download/bun-v1.4.4/bun-windows-x64.zip'
const sha256 = 'cd2c0fccc78f3ede1f50ca827a15f063eda13d4d150a3d0674f4f6e323d864a5'
await mkdir(root, { recursive: true })
const archive = join(root, 'bun-v1.4.4-windows-x64.zip')
let bytes
try {
  bytes = await readFile(archive)
} catch (error) {
  if (error.code !== 'ENOENT') throw error
  const response = await fetch(url, { signal: AbortSignal.timeout(120000) })
  if (!response.ok) throw new Error(`Bun download failed: ${response.status}`)
  bytes = Buffer.from(await response.arrayBuffer())
}
const digest = createHash('sha256').update(bytes).digest('hex')
if (digest !== sha256) throw new Error(`Bun archive SHA256 mismatch: ${digest}`)
await writeFile(archive, bytes)
execFileSync('powershell', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${archive.replaceAll("'", "''")}' -DestinationPath '${root.replaceAll("'", "''")}' -Force`], { stdio: 'pipe' })
const executable = join(root, 'bun-windows-x64/bun.exe')
const version = execFileSync(executable, ['--version'], { encoding: 'utf8' }).trim()
if (version !== '1.4.4') throw new Error(`Unexpected Bun version: ${version}`)
await writeFile(join(root, 'verified.json'), JSON.stringify({ version, url, sha256, executable }, null, 2) + '\n')
process.stdout.write(JSON.stringify({ version, executable, sha256 }) + '\n')
