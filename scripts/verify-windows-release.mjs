import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'

assert.equal(process.platform, 'win32', 'Windows release inspection requires Windows')
const repository = resolve(import.meta.dirname, '..')
const json = path => JSON.parse(readFileSync(resolve(repository, path), 'utf8'))
const pkg = json('package.json')
const config = json('src-tauri/tauri.conf.json')
const lock = json('package-lock.json')
const runtime = json('resources/conpty.lock.json')
const metadata = JSON.parse(execFileSync('cargo', ['metadata', '--format-version', '1', '--no-deps', '--manifest-path', join(repository, 'src-tauri/Cargo.toml')], { encoding: 'utf8', windowsHide: true }))
const application = metadata.packages.find(item => item.name === 'patty')
assert.ok(application, 'Cargo application metadata is missing')
for (const version of [config.version, lock.version, lock.packages[''].version, application.version]) assert.equal(version, pkg.version, 'Release version manifests disagree')
assert.equal(config.identifier, 'com.patty.app')
assert.equal(config.bundle.windows.nsis.installMode, 'currentUser')
const directory = join(metadata.target_directory, 'release')
const installer = resolve(process.argv[2] ?? join(directory, 'bundle/nsis', `Patty_${pkg.version}_x64-setup.exe`))
const executable = resolve(process.argv[3] ?? join(directory, 'patty.exe'))
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex')
const versions = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `
    @($env:PATTY_RELEASE_INSTALLER,$env:PATTY_RELEASE_EXECUTABLE) | ForEach-Object {
        $file=Get-Item -LiteralPath $_
        @{path=$file.FullName;productVersion=$file.VersionInfo.ProductVersion;fileVersion=$file.VersionInfo.FileVersion}
    } | ConvertTo-Json -Compress
`], { encoding: 'utf8', windowsHide: true, env: { ...process.env, PATTY_RELEASE_INSTALLER: installer, PATTY_RELEASE_EXECUTABLE: executable } }))
for (const file of versions) {
  assert.equal(file.productVersion, pkg.version, `Unexpected product version in ${file.path}`)
  assert.equal(file.fileVersion, pkg.version, `Unexpected file version in ${file.path}`)
}

const temporary = mkdtempSync(join(tmpdir(), 'patty-release-inspection-'))
const verified = []
const checkFile = (path, expected) => {
  const full = join(temporary, path)
  assert.ok(existsSync(full), `Installer omits ${path}`)
  assert.equal(hash(full), expected, `Installer contains an unexpected ${path}`)
  const normalized = path.replaceAll('\\', '/')
  if (!verified.some(item => item.path === normalized)) verified.push({ path: normalized, sha256: expected, bytes: readFileSync(full).length })
}
const walk = root => readdirSync(root, { withFileTypes: true }).flatMap(item => item.isDirectory() ? walk(join(root, item.name)) : [join(root, item.name)])

try {
  execFileSync('7z', ['x', '-y', `-o${temporary}`, installer], { stdio: 'pipe', windowsHide: true })
  const binary = readFileSync(executable)
  const marker = Buffer.from('__TAURI_BUNDLE_TYPE_VAR_UNK')
  const markerOffset = binary.indexOf(marker)
  assert.ok(markerOffset >= 0, 'Standalone executable has no Tauri bundle marker')
  assert.equal(binary.indexOf(marker, markerOffset + 1), -1, 'Standalone executable has ambiguous Tauri bundle markers')
  const bundled = Buffer.from(binary)
  bundled.write('__TAURI_BUNDLE_TYPE_VAR_NSS', markerOffset, 'ascii')
  checkFile('patty.exe', createHash('sha256').update(bundled).digest('hex'))
  for (const [architecture, files] of Object.entries(runtime.files)) {
    for (const [name, entry] of Object.entries(files)) checkFile(join('conpty', architecture, name), entry.sha256)
  }
  checkFile('conpty/LICENSE.txt', runtime.license.sha256)
  for (const [source, destination] of Object.entries(config.bundle.resources)) {
    if (!source.endsWith('/')) checkFile(destination, hash(resolve(repository, 'src-tauri', source)))
  }
  assert.equal(binary.readUInt16LE(binary.readUInt32LE(0x3c) + 4), 0x8664, 'Release executable must be x64')
  assert.equal(binary.includes(Buffer.from('native_verification_exchange')), false, 'Production executable contains native verification controls')
  const frontend = walk(join(repository, 'out/renderer')).filter(path => path.endsWith('.js'))
  assert.ok(frontend.length > 0, 'Production frontend is missing')
  for (const path of frontend) {
    assert.doesNotMatch(readFileSync(path, 'utf8'), /native_verification_exchange|callbackClassId|native-request\.json/, `Production frontend contains verification controls: ${path}`)
  }
  const isolation = execFileSync(process.execPath, [join(repository, 'e2e/isolation.test.mjs'), '--expect-unsupported-build'], {
    cwd: repository, encoding: 'utf8', windowsHide: true, timeout: 30_000, env: { ...process.env, PATTY_EXE: join(temporary, 'patty.exe') },
  })
  process.stdout.write(isolation)
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8', windowsHide: true }).trim()
  const output = join(repository, 'output/releases', pkg.version)
  mkdirSync(output, { recursive: true })
  const packagedExecutable = join(temporary, 'patty.exe')
  const artifacts = [installer, packagedExecutable].map(path => ({ name: basename(path), sha256: hash(path), bytes: readFileSync(path).length }))
  for (const [index, source] of [installer, packagedExecutable].entries()) {
    const target = join(output, artifacts[index].name)
    if (existsSync(target)) assert.equal(hash(target), artifacts[index].sha256, `Existing release artifact differs: ${target}`)
    else copyFileSync(source, target)
  }
  writeFileSync(join(output, 'SHA256SUMS'), artifacts.map(item => `${item.sha256}  ${item.name}`).join('\n') + '\n')
  writeFileSync(join(output, 'report.json'), JSON.stringify({ status: 'ok', version: pkg.version, inspectionRevision: revision, identity: config.identifier, installMode: config.bundle.windows.nsis.installMode,
    artifacts, standaloneExecutableSha256: hash(executable), bundleMarker: 'UNK -> NSS; all other bytes identical', verifiedFiles: verified,
    productionIsolation: 'passed', installation: 'pending', installedActivation: 'pending' }, null, 2) + '\n')
  console.log(`PASS: ${pkg.version} installer, executable, ${verified.length} packaged files, production isolation and checksums`)
  console.log(output)
} finally {
  assert.equal(dirname(resolve(temporary)), resolve(tmpdir()))
  assert.ok(basename(temporary).startsWith('patty-release-inspection-'))
  rmSync(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
}
