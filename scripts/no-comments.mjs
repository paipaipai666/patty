import { readFileSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const CHECK = process.argv.includes('--check')
const ROOT = fileURLToPath(new URL('..', import.meta.url))

const DIRECTIVE_RE = /^\s*(@ts-expect-error|@ts-ignore|@ts-nocheck|eslint-disable|eslint-enable|prettier-ignore|@formatter:|istanbul ignore|c8 ignore|v8 ignore|biome-ignore|deno-lint)/
const KIND_BY_EXT = {
  ts: 'js', tsx: 'js', js: 'js', mjs: 'js', cjs: 'js',
  rs: 'rust', css: 'css', html: 'html', ps1: 'ps1',
}

function lineOf(text, pos) {
  let n = 1
  for (let i = 0; i < pos; i++) if (text[i] === '\n') n++
  return n
}

function scanJs(text, hits) {
  const out = []
  let i = 0
  const n = text.length
  let prevSig = ''
  let prevWord = ''
  let curLineStart = 0
  const frames = []
  let mode = 'normal'
  let classDepth = 0
  const push = (ch) => {
    out.push(ch)
    if (ch === '\n') curLineStart = out.length
  }
  while (i < n) {
    const c = text[i]
    const next = text[i + 1]
    if (mode === 'line') {
      if (c === '\n') { mode = 'normal'; push(c) } else out.push(' ')
      i++
      continue
    }
    if (mode === 'block') {
      if (c === '*' && next === '/') {
        out.push(' ', ' ')
        i += 2
        mode = 'normal'
        continue
      }
      push(c === '\n' ? '\n' : ' ')
      i++
      continue
    }
    if (mode === 'sq' || mode === 'dq' || mode === 'regex') {
      push(c)
      if (c === '\\') { push(next ?? ''); i += 2; continue }
      if (mode === 'regex') {
        if (c === '[') classDepth++
        else if (c === ']') classDepth = Math.max(0, classDepth - 1)
        else if (c === '/' && classDepth === 0) {
          mode = 'normal'
          i++
          while (i < n && /[a-z]/i.test(text[i])) push(text[i++])
          prevSig = 'x'
          prevWord = 'x'
          continue
        }
      } else if (c === (mode === 'sq' ? "'" : '"')) {
        mode = 'normal'
      }
      if (c === '\n') mode = 'normal'
      i++
      continue
    }
    if (mode === 'tq') {
      push(c)
      if (c === '\\') { push(next ?? ''); i += 2; continue }
      if (c === '`') { mode = 'normal'; i++; continue }
      if (c === '$' && next === '{') {
        frames.push({ type: 'tpl', braces: 0 })
        push(next)
        i += 2
        mode = 'normal'
        continue
      }
      i++
      continue
    }
    if (c === "'") { mode = 'sq'; push(c); i++; continue }
    if (c === '"') { mode = 'dq'; push(c); i++; continue }
    if (c === '`') { mode = 'tq'; push(c); i++; continue }
    if (c === '/' && next === '/') {
      const eol = text.indexOf('\n', i)
      const rest = text.slice(i + 2, eol === -1 ? n : eol)
      const isShebang = text[i + 2] === '!' && out.length === curLineStart
      if (isShebang || DIRECTIVE_RE.test(rest)) {
        while (i < n && text[i] !== '\n') push(text[i++])
        continue
      }
      hits.push({ pos: i, kind: 'line' })
      mode = 'line'
      out.push(' ', ' ')
      i += 2
      continue
    }
    if (c === '/' && next === '*') {
      hits.push({ pos: i, kind: 'block' })
      mode = 'block'
      out.push(' ', ' ')
      i += 2
      continue
    }
    if (c === '/' && (prevSig === '' || '=(,:[!&|?{;}+-*%<>~^'.includes(prevSig) || ['return', 'typeof', 'case', 'in', 'of', 'do', 'else', 'void', 'delete', 'new', 'instanceof', 'yield', 'await'].includes(prevWord))) {
      mode = 'regex'
      classDepth = 0
      push(c)
      i++
      continue
    }
    if (c === '{') {
      const f = frames[frames.length - 1]
      if (f && f.type === 'tpl') f.braces++
    } else if (c === '}') {
      const f = frames[frames.length - 1]
      if (f && f.type === 'tpl') {
        if (f.braces === 0) {
          frames.pop()
          mode = 'tq'
          push(c)
          i++
          continue
        }
        f.braces--
      }
    }
    if (!/\s/.test(c)) {
      prevSig = c
      if (/[A-Za-z_$]/.test(c)) {
        let j = i
        while (j < n && /[A-Za-z0-9_$]/.test(text[j])) j++
        prevWord = text.slice(i, j)
        while (i < j) push(text[i++])
        continue
      }
      prevWord = ''
    }
    push(c)
    i++
  }
  return out.join('')
}

function scanRust(text, hits) {
  const out = []
  let i = 0
  const n = text.length
  let mode = 'normal'
  let blockDepth = 0
  while (i < n) {
    const c = text[i]
    const next = text[i + 1]
    if (mode === 'line') {
      if (c === '\n') { mode = 'normal'; out.push(c) } else out.push(' ')
      i++
      continue
    }
    if (mode === 'block') {
      if (c === '/' && next === '*') { blockDepth++; out.push(' ', ' '); i += 2; continue }
      if (c === '*' && next === '/') {
        blockDepth--
        out.push(' ', ' ')
        i += 2
        if (blockDepth === 0) mode = 'normal'
        continue
      }
      out.push(c === '\n' ? '\n' : ' ')
      i++
      continue
    }
    if (mode === 'dq') {
      out.push(c)
      if (c === '\\') { out.push(next ?? ''); i += 2; continue }
      if (c === '"') mode = 'normal'
      i++
      continue
    }
    if (c === '/' && next === '/') {
      hits.push({ pos: i, kind: 'line' })
      mode = 'line'
      out.push(' ', ' ')
      i += 2
      continue
    }
    if (c === '/' && next === '*') {
      hits.push({ pos: i, kind: 'block' })
      mode = 'block'
      blockDepth = 1
      out.push(' ', ' ')
      i += 2
      continue
    }
    if (c === '"') { mode = 'dq'; out.push(c); i++; continue }
    if (c === 'r' && (i === 0 || !/[A-Za-z0-9_]/.test(text[i - 1]))) {
      let j = i + 1
      let hashes = 0
      while (text[j] === '#') { hashes++; j++ }
      if (text[j] === '"') {
        out.push(text.slice(i, j + 1))
        i = j + 1
        const close = '"' + '#'.repeat(hashes)
        const end = text.indexOf(close, i)
        const stop = end === -1 ? n : end + close.length
        while (i < stop) out.push(text[i++])
        continue
      }
    }
    if (c === "'" && text[i + 2] === "'") {
      out.push(text[i], text[i + 1], text[i + 2])
      i += 3
      continue
    }
    if (c === "'" && text[i + 1] === '\\') {
      let j = i + 2
      const lim = Math.min(i + 8, n)
      while (j < lim && text[j] !== "'") j++
      while (i <= j && i < n) out.push(text[i++])
      continue
    }
    out.push(c)
    i++
  }
  return out.join('')
}

function scanCss(text, hits) {
  const out = []
  let i = 0
  const n = text.length
  let inStr = null
  while (i < n) {
    const c = text[i]
    const next = text[i + 1]
    if (inStr) {
      out.push(c)
      if (c === '\\') { out.push(next ?? ''); i += 2; continue }
      if (c === inStr) inStr = null
      i++
      continue
    }
    if (c === '"' || c === "'") { inStr = c; out.push(c); i++; continue }
    if (c === '/' && next === '*') {
      hits.push({ pos: i, kind: 'block' })
      let j = i + 2
      while (j < n && !(text[j] === '*' && text[j + 1] === '/')) {
        out.push(text[j] === '\n' ? '\n' : ' ')
        j++
      }
      if (j < n) { out.push(' ', ' '); j += 2 }
      i = j
      continue
    }
    out.push(c)
    i++
  }
  return out.join('')
}

function scanHtml(text, hits) {
  const out = []
  let i = 0
  const n = text.length
  while (i < n) {
    if (text.startsWith('<!--', i)) {
      const end = text.indexOf('-->', i + 4)
      const stop = end === -1 ? n : end + 3
      hits.push({ pos: i, kind: 'html' })
      for (let k = i; k < stop; k++) out.push(text[k] === '\n' ? '\n' : ' ')
      i = stop
      continue
    }
    out.push(text[i])
    i++
  }
  return out.join('')
}

function scanPs1(text, hits) {
  const out = []
  let i = 0
  const n = text.length
  let inStr = null
  while (i < n) {
    const c = text[i]
    const next = text[i + 1]
    if (inStr) {
      out.push(c)
      if (c === '`') { out.push(next ?? ''); i += 2; continue }
      if (c === inStr) inStr = null
      i++
      continue
    }
    if (c === "'" || c === '"') { inStr = c; out.push(c); i++; continue }
    if (c === '#') {
      const eol = text.indexOf('\n', i)
      const rest = text.slice(i + 1, eol === -1 ? n : eol)
      if (DIRECTIVE_RE.test(rest)) {
        while (i < n && text[i] !== '\n') out.push(text[i++])
        continue
      }
      hits.push({ pos: i, kind: 'line' })
      while (i < n && text[i] !== '\n') out.push(' '), i++
      continue
    }
    out.push(c)
    i++
  }
  return out.join('')
}

const SCANNERS = { js: scanJs, rust: scanRust, css: scanCss, html: scanHtml, ps1: scanPs1 }

function tidy(text) {
  const lines = text.split('\n').map((l) => l.replace(/[ \t]+$/, ''))
  const res = []
  let blank = 0
  for (const l of lines) {
    if (l === '') {
      blank++
      if (blank <= 1) res.push(l)
    } else {
      blank = 0
      res.push(l)
    }
  }
  return res.join('\n').replace(/\n+$/g, '\n')
}

function main() {
  const files = execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .map((f) => f.trim())
    .filter(Boolean)
    .filter((f) => KIND_BY_EXT[f.split('.').pop().toLowerCase()])
  let failures = 0
  for (const rel of files) {
    const path = join(ROOT, rel)
    const text = readFileSync(path, 'utf8')
    const hits = []
    const stripped = SCANNERS[KIND_BY_EXT[rel.split('.').pop().toLowerCase()]](text, hits)
    if (hits.length === 0) continue
    if (CHECK) {
      failures += hits.length
      for (const h of hits.slice(0, 20)) {
        const ln = lineOf(text, h.pos)
        const preview = text.slice(h.pos, h.pos + 60).split('\n')[0]
        console.log(`${rel}:${ln} [${h.kind}] ${preview}`)
      }
    } else {
      writeFileSync(path, tidy(stripped), 'utf8')
      console.log(`stripped ${rel} (${hits.length})`)
    }
  }
  if (CHECK) {
    if (failures > 0) {
      console.log(`\n${failures} comment(s) found — explanatory comments are not allowed in this repo.`)
      process.exit(1)
    }
    console.log('no comments — ok')
  }
}

main()
