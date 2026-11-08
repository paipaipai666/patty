import { cp, mkdir, readFile, readdir, symlink, lstat, realpath, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const integration = dirname(fileURLToPath(import.meta.url))
const project = resolve(integration, '../..')
const source = resolve(process.env.OMP_SOURCE_MODULES ?? join(process.env.USERPROFILE ?? '', '.bun/install/global/node_modules'))
const target = join(project, 'output/omp-navigation/node_modules')
const copied = new Set(['pi-coding-agent', 'pi-tui'])
const lock = JSON.parse(await readFile(join(integration, 'upstream-lock.json'), 'utf8'))
const version = JSON.parse(await readFile(join(source, '@oh-my-pi/pi-coding-agent/package.json'), 'utf8')).version
if (version !== lock.version) throw new Error(`Expected OMP ${lock.version}, received ${version}`)
for (const expected of lock.sources) {
  const hash = createHash('sha256').update(await readFile(join(source, '@oh-my-pi', expected.file))).digest('hex')
  if (hash !== expected.sha256) throw new Error(`OMP source fingerprint mismatch: ${expected.file}`)
}
await mkdir(join(target, '@oh-my-pi'), { recursive: true })
const expectedTarget = join(await realpath(project), 'output/omp-navigation/node_modules')
if ((await realpath(target)).toLowerCase() !== expectedTarget.toLowerCase()) throw new Error('OMP workspace must remain inside project output')

async function link(from, to) {
  try {
    await lstat(to)
    if ((await realpath(to)).toLowerCase() !== (await realpath(from)).toLowerCase()) throw new Error(`Unexpected dependency link: ${to}`)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    await symlink(from, to, 'junction')
  }
}

for (const item of await readdir(source, { withFileTypes: true })) {
  if (item.name === '@oh-my-pi') continue
  await link(join(source, item.name), join(target, item.name))
}
for (const item of await readdir(join(source, '@oh-my-pi'), { withFileTypes: true })) {
  const from = join(source, '@oh-my-pi', item.name)
  const to = join(target, '@oh-my-pi', item.name)
  if (copied.has(item.name)) {
    try {
      if ((await lstat(to)).isSymbolicLink()) throw new Error(`Refusing to copy onto dependency link: ${to}`)
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    await cp(from, to, { recursive: true, force: true })
  }
  else await link(from, to)
}
await link(target, join(integration, 'node_modules'))
await writeFile(resolve(project, 'output/omp-navigation/source-manifest.json'), JSON.stringify({ version, source, sources: lock.sources }, null, 2) + '\n')
process.stdout.write(JSON.stringify({ version, source, target, entry: join(target, '@oh-my-pi/pi-coding-agent/src/cli.ts') }) + '\n')
