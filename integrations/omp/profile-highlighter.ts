import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getMarkdownTheme } from '@oh-my-pi/pi-tui/theme'
import { sliceByColumn, visibleWidth } from '@oh-my-pi/pi-tui/utils'

const arguments_ = process.argv.slice(2)
const sizeAt = arguments_.indexOf('--characters')
const characters = sizeAt < 0 ? 20_000 : Number(arguments_[sizeAt + 1])
if (!Number.isSafeInteger(characters) || characters < 1 || characters > 40_000) {
  throw new RangeError('--characters must be an integer from 1 through 40000')
}
const completeLine = arguments_.includes('--complete-line')
const stream = getMarkdownTheme().createHighlightStream?.('typescript')
if (!stream) throw new Error('The pinned native TypeScript highlighter is unavailable')
const prefix = 'const value = "' + 'x'.repeat(characters)
const source = prefix + 'x'.repeat(160) + (completeLine ? '";\n' : '')
let start = performance.now()
const ansi = stream.push(source)
const nativeParseMs = performance.now() - start
start = performance.now()
const prefixWidth = visibleWidth(prefix)
const outputWidth = visibleWidth(ansi)
const widthMs = performance.now() - start
start = performance.now()
const visible = sliceByColumn(ansi, prefixWidth, Math.max(0, outputWidth - prefixWidth))
const sliceMs = performance.now() - start
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const reportPath = resolve(root, 'output/omp-navigation/native-highlight-profile.json')
const report = {
  upstreamVersion: '18.13.3',
  runtime: process.versions.bun,
  characters,
  completeLine,
  sourceLength: source.length,
  ansiLength: ansi.length,
  visibleAnsiLength: visible.length,
  nativeParseMs,
  widthMs,
  sliceMs,
  coldNavigationBudgetMs: 500,
  nativeParseWithinColdBudget: nativeParseMs <= 500,
  scope: 'native parse only; excludes CLI, ConPTY and xterm rendering',
}
await mkdir(dirname(reportPath), { recursive: true })
await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify({ ...report, reportPath }))
