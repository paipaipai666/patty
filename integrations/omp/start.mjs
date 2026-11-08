import { createHash } from 'node:crypto'
import { readFile, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const workspace = join(repository, 'output/omp-navigation')
const root = join(workspace, 'node_modules/@oh-my-pi/pi-coding-agent')
try {
  const manifest = JSON.parse(await readFile(join(workspace, 'patch-manifest.json'), 'utf8'))
  if (manifest.version !== '18.13.3' || !Array.isArray(manifest.files) || manifest.files.length === 0) throw new Error('Invalid companion manifest')
  const allowed = (await realpath(join(workspace, 'node_modules/@oh-my-pi'))).toLowerCase()
  for (const file of manifest.files) {
    if (typeof file.file !== 'string' || typeof file.sha256 !== 'string') throw new Error('Invalid companion file record')
    const path = await realpath(resolve(root, file.file))
    const fromRoot = relative(allowed, path.toLowerCase())
    if (isAbsolute(fromRoot) || fromRoot === '..' || fromRoot.startsWith('..' + sep)) throw new Error('Companion file escaped its isolated packages')
    const digest = createHash('sha256').update(await readFile(path)).digest('hex')
    if (digest !== file.sha256) throw new Error(`Companion file changed: ${file.file}. Run npm run omp:legacy:prepare.`)
  }
  const child = spawn(join(workspace, 'runtime/bun-windows-x64/bun.exe'), [join(root, 'src/cli.ts'), ...process.argv.slice(2)], {
    cwd: process.cwd(), env: process.env, stdio: 'inherit', windowsHide: true
  })
  child.on('error', error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1 })
  child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0) })
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\nPrepare the isolated companion with npm run omp:legacy:prepare.\n`)
  process.exitCode = 1
}
