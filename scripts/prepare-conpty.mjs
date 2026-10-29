import { createHash, randomUUID } from 'node:crypto'
import { readFile, writeFile, mkdir, rename, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { inflateRawSync } from 'node:zlib'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const architectures = ['x64', 'x86', 'arm64']
const names = ['conpty.dll', 'OpenConsole.exe']
const sha256 = data => createHash('sha256').update(data).digest('hex')

function options(args) {
  const value = { check: false, postinstall: false, archive: null, cache: join(tmpdir(), 'patty-conpty'), output: join(root, 'resources', 'conpty') }
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--check') value.check = true
    else if (args[i] === '--postinstall') value.postinstall = true
    else if (['--archive', '--output', '--cache'].includes(args[i]) && args[i + 1]) value[args[i].slice(2)] = resolve(args[++i])
    else throw new Error(`Unknown or incomplete option: ${args[i]}`)
  }
  return value
}

async function readOptional(path) {
  try { return await readFile(path) }
  catch (error) { if (error.code === 'ENOENT') return null; throw error }
}

async function writeAtomic(path, data) {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, data, { flag: 'wx' })
    await rename(temporary, path)
  } finally {
    await rm(temporary, { force: true })
  }
}

async function download(url, size) {
  const signal = AbortSignal.timeout(60000)
  for (let redirects = 0; redirects <= 5; redirects++) {
    if (new URL(url).protocol !== 'https:') throw new Error('ConPTY download must use HTTPS')
    const response = await fetch(url, { redirect: 'manual', signal })
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      await response.body?.cancel()
      if (!location) throw new Error('ConPTY download redirect has no location')
      url = new URL(location, url).href
      continue
    }
    if (!response.ok) throw new Error(`ConPTY download returned HTTP ${response.status}`)
    const chunks = []
    let received = 0
    for await (const chunk of response.body) {
      received += chunk.length
      if (received > size) throw new Error('ConPTY package exceeds its locked size')
      chunks.push(chunk)
    }
    return Buffer.concat(chunks)
  }
  throw new Error('ConPTY download exceeded five redirects')
}

function extract(archive, member, expectedSize) {
  let end = archive.length - 22
  const minimum = Math.max(0, archive.length - 65557)
  while (end >= minimum && archive.readUInt32LE(end) !== 0x06054b50) end--
  if (end < minimum) throw new Error('ConPTY package has no ZIP directory')
  const count = archive.readUInt16LE(end + 10)
  let offset = archive.readUInt32LE(end + 16)
  if (count > 512 || offset === 0xffffffff) throw new Error('Unsupported ConPTY ZIP directory')
  for (let i = 0; i < count; i++) {
    if (archive.readUInt32LE(offset) !== 0x02014b50) throw new Error('Invalid ConPTY ZIP directory entry')
    const nameLength = archive.readUInt16LE(offset + 28)
    const extraLength = archive.readUInt16LE(offset + 30)
    const commentLength = archive.readUInt16LE(offset + 32)
    const name = archive.toString('utf8', offset + 46, offset + 46 + nameLength)
    if (name === member) {
      const method = archive.readUInt16LE(offset + 10)
      const compressedSize = archive.readUInt32LE(offset + 20)
      const size = archive.readUInt32LE(offset + 24)
      const local = archive.readUInt32LE(offset + 42)
      if (size !== expectedSize || (archive.readUInt16LE(offset + 8) & 1)) throw new Error(`Unexpected ZIP metadata for ${member}`)
      if (archive.readUInt32LE(local) !== 0x04034b50) throw new Error(`Invalid ZIP data for ${member}`)
      const start = local + 30 + archive.readUInt16LE(local + 26) + archive.readUInt16LE(local + 28)
      const compressed = archive.subarray(start, start + compressedSize)
      if (method === 0) return Buffer.from(compressed)
      if (method === 8) return inflateRawSync(compressed, { maxOutputLength: expectedSize })
      throw new Error(`Unsupported ZIP compression for ${member}`)
    }
    offset += 46 + nameLength + extraLength + commentLength
  }
  throw new Error(`ConPTY package is missing ${member}`)
}

async function main() {
  const args = options(process.argv.slice(2))
  if (args.postinstall && process.platform !== 'win32') {
    console.log('ConPTY preparation skipped on this non-Windows install')
    return
  }
  const lock = JSON.parse(await readFile(join(root, 'resources', 'conpty.lock.json'), 'utf8'))
  if (lock.schemaVersion !== 1 || lock.package !== 'Microsoft.Windows.Console.ConPTY' || !/^\d+\.\d+\.\d+$/.test(lock.version)) throw new Error('Invalid ConPTY version lock')
  const url = `https://www.nuget.org/api/v2/package/${lock.package}/${lock.version}`
  if (lock.url !== url || !/^[a-f0-9]{64}$/.test(lock.sha256) || !Number.isSafeInteger(lock.bytes) || lock.bytes <= 0 || lock.bytes > 16 * 1024 * 1024) throw new Error('Invalid ConPTY package lock')
  const license = await readFile(join(root, 'licenses', 'conpty-LICENSE.txt'))
  if (sha256(license) !== lock.license.sha256) throw new Error('ConPTY license differs from its locked Microsoft notice')
  const assets = []
  for (const arch of architectures) {
    for (const name of names) {
      const file = lock.files[arch][name]
      const member = name === 'conpty.dll' ? `runtimes/win-${arch}/native/conpty.dll` : `build/native/runtimes/${arch}/OpenConsole.exe`
      if (file.member !== member || !/^[a-f0-9]{64}$/.test(file.sha256) || !Number.isSafeInteger(file.bytes) || file.bytes <= 0) throw new Error(`Invalid ConPTY file lock: ${arch}/${name}`)
      const path = join(args.output, arch, name)
      const current = await readOptional(path)
      assets.push({ ...file, path, valid: current?.length === file.bytes && sha256(current) === file.sha256 })
    }
  }
  const missing = assets.filter(asset => !asset.valid)
  if (args.check) {
    if (missing.length) throw new Error(`ConPTY files missing or modified: ${missing.map(asset => asset.path).join(', ')}`)
    console.log(`ConPTY ${lock.version}: six native files verified`)
    return
  }
  if (!missing.length && !args.archive) {
    console.log(`ConPTY ${lock.version}: native files already verified`)
    return
  }
  const cache = join(args.cache, lock.version, `${lock.package}.nupkg`)
  let archive = await readOptional(args.archive ?? cache)
  if (args.archive && !archive) throw new Error(`ConPTY archive does not exist: ${args.archive}`)
  if (!args.archive && (!archive || archive.length !== lock.bytes || sha256(archive) !== lock.sha256)) archive = await download(url, lock.bytes)
  if (!archive || archive.length !== lock.bytes || sha256(archive) !== lock.sha256) throw new Error('ConPTY package SHA-256 or size does not match the lock')
  for (const asset of missing) {
    const bytes = extract(archive, asset.member, asset.bytes)
    if (bytes.length !== asset.bytes || sha256(bytes) !== asset.sha256) throw new Error(`ConPTY extracted file failed SHA-256 verification: ${asset.member}`)
    await writeAtomic(asset.path, bytes)
  }
  await writeAtomic(cache, archive)
  console.log(`ConPTY ${lock.version}: prepared and verified ${missing.length} native files`)
}

main().catch(error => {
  console.error(`ConPTY preparation failed: ${error.message}`)
  process.exitCode = 1
})
