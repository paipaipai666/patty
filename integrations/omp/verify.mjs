import { readFile, realpath } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const project = resolve(here, '../..')
const workspace = join(project, 'output/omp-navigation')
const packageRoot = join(workspace, 'node_modules/@oh-my-pi/pi-coding-agent')
const lock = JSON.parse(await readFile(join(here, 'upstream-lock.json'), 'utf8'))
const sourceManifest = JSON.parse(await readFile(join(workspace, 'source-manifest.json'), 'utf8'))
const patches = JSON.parse(await readFile(join(workspace, 'patch-manifest.json'), 'utf8'))
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
if (sourceManifest.version !== lock.version || patches.version !== lock.version) throw new Error('OMP manifest version mismatch')
const patchedPaths = new Set(patches.files.map(item => resolve(packageRoot, item.file).toLowerCase()))
for (const item of lock.sources) {
  const actual = hash(await readFile(join(sourceManifest.source, '@oh-my-pi', item.file)))
  if (actual !== item.sha256) throw new Error(`Global OMP source changed: ${item.file}`)
  const copied = join(workspace, 'node_modules/@oh-my-pi', item.file)
  if (!patchedPaths.has(resolve(copied).toLowerCase()) && hash(await readFile(copied)) !== item.sha256) throw new Error(`Upstream copy changed: ${item.file}`)
}
const owned = (await realpath(join(workspace, 'node_modules/@oh-my-pi'))).toLowerCase() + sep
for (const item of patches.files) {
  const file = await realpath(join(packageRoot, item.file))
  if (!file.toLowerCase().startsWith(owned)) throw new Error(`Manifest path escaped workspace: ${item.file}`)
  if (hash(await readFile(file)) !== item.sha256) throw new Error(`Patched file changed: ${item.file}`)
}
const modules = ['native-navigation.ts', 'navigation-api.ts', 'canonical-renderer.ts', 'markdown-range.ts', 'markdown-source-map.ts', 'progressive-highlight.ts', 'highlight-worker.ts']
for (const name of modules) {
  const source = await readFile(join(here, name))
  const copied = await readFile(join(packageRoot, 'src/modes/controllers', name))
  if (!source.equals(copied)) throw new Error(`Companion copy differs: ${name}`)
}
const tuiMapper = await readFile(join(workspace, 'node_modules/@oh-my-pi/pi-tui/src/components/markdown-source-map.ts'))
if (!tuiMapper.equals(await readFile(join(here, 'markdown-source-map.ts')))) throw new Error('TUI source mapper differs')
process.stdout.write(JSON.stringify({ passed: true, version: lock.version, globalSources: lock.sources.length, patchedFiles: patches.files.length, companionModules: modules.length }) + '\n')
