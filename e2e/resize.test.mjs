import { pathToFileURL } from 'node:url'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeFile } from 'node:fs/promises'

const repo = resolve(process.argv[2] || process.cwd())
const { launchApp } = await import(pathToFileURL(join(repo, 'e2e/harness.mjs')))
const out = process.argv[3] || process.env.PATTY_E2E_OUTPUT || dirname(fileURLToPath(import.meta.url))
process.chdir(repo)
const run = await launchApp()
const { cdp } = run
const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = {}
const lifecycleOnly = process.argv.includes('--lifecycle-only')
const bodyLength = lifecycleOnly ? 10 : 150

try {
  await cdp.evaluate(`(() => {
    window.__probe = { events: [], data: [], creates: [] }
    const api = window.terminalAPI
    const create = api.createSession
    api.createSession = (...args) => create(...args).then(result => {
      window.__probe.creates.push({ args, result, t: performance.now() })
      return result
    })
    const resize = api.resize
    api.resize = (id, cols, rows) => {
      window.__probe.events.push({ kind: 'resize', id, cols, rows, t: performance.now() })
      return resize(id, cols, rows)
    }
    const onData = api.onData
    api.onData = (id, cb) => onData(id, s => {
      window.__probe.data.push({ id, s, t: performance.now() })
      cb(s)
    })
    window.__terms = () => [...document.querySelectorAll('.xterm')].map(el => {
      let fiber = el.parentElement[Object.keys(el.parentElement).find(k => k.startsWith('__reactFiber'))]
      for (; fiber; fiber = fiber.return) {
        for (let hook = fiber.memoizedState; hook; hook = hook.next) {
          const term = hook.memoizedState?.current
          if (term && typeof term.write === 'function' && term.buffer) return term
        }
      }
    }).filter(Boolean)
    window.__snapshot = () => window.__terms().map(term => {
      const lines = []
      const physical = []
      const buffer = term.buffer.active
      for (let i = 0; i < buffer.length; i++) {
        const line = buffer.getLine(i)
        const text = line.translateToString(true)
        physical.push({ text, isWrapped: line.isWrapped })
        if (line.isWrapped && lines.length) lines[lines.length - 1] += text
        else lines.push(text)
      }
      return { cols: term.cols, rows: term.rows, lines, physical }
    })
    document.querySelector('button[aria-label="New terminal or collection"]').click()
  })()`)
  await cdp.waitFor(`[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'New Terminal')`)
  await cdp.evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'New Terminal').click()`)
  await cdp.waitFor(`window.__probe.creates.length === 1 && window.__terms().length === 1 && /PID \\d+/.test(document.body.innerText)`)
  await sleep(800)
  const id = await cdp.evaluate('window.__probe.creates[0].args[0]')
  const stream = async (label, count, letter) => {
    const command = `$i=0; while($i -lt ${count}){[Console]::WriteLine(("${label}:{0:D5}|{1}|END:{0:D5}" -f $i,("${letter}"*${bodyLength})));$i++;[Threading.Thread]::Sleep(10)}\r`
    await cdp.evaluate(`window.terminalAPI.write(${JSON.stringify(id)}, ${JSON.stringify(command)})`)
  }
  const measure = async (label, count, letter) => cdp.evaluate(`(() => {
    const snapshot = window.__snapshot()[0]
    const label = ${JSON.stringify(label)}
    const hits = snapshot.lines.map(s => s.trimEnd()).filter(s => new RegExp('^' + label + ':[0-9]{5}').test(s))
    const ids = hits.map(s => Number(s.slice(label.length + 1, label.length + 6)))
    const expected = i => label + ':' + String(i).padStart(5, '0') + '|' + ${JSON.stringify(letter.repeat(bodyLength))} + '|END:' + String(i).padStart(5, '0')
    return {
      count: hits.length,
      duplicates: ids.filter((id, index) => ids.indexOf(id) !== index),
      orphaned: snapshot.lines.filter(line => new RegExp('^(?:' + ${JSON.stringify(letter)} + '){20,}').test(line.trimStart())),
      missing: Array.from({ length: ${count} }, (_, i) => i).filter(i => !ids.includes(i)),
      malformed: hits.filter(s => s !== expected(Number(s.slice(label.length + 1, label.length + 6)))),
      cols: snapshot.cols, rows: snapshot.rows, snapshot
    }
  })()`)
  const waitLast = (label, count) => cdp.waitFor(`window.__snapshot()[0].lines.some(s => s.startsWith(${JSON.stringify(label + ':' + String(count - 1).padStart(5, '0') + '|')}))`, 15000)
  await stream('BASE', 100, 'A')
  await waitLast('BASE', 100)
  await sleep(300)
  results.baseline = await measure('BASE', 100, 'A')
  if (!lifecycleOnly) {
    await stream('MAX', 300, 'B')
    for (let i = 0; i < 3; i++) {
      await sleep(600)
      await cdp.evaluate('window.terminalAPI.windowMaximize()')
    }
    await waitLast('MAX', 300)
    await sleep(300)
    results.maximize = await measure('MAX', 300, 'B')
  }
  await cdp.evaluate(`document.querySelector('button[aria-label="Split terminal to the right"]').click()`)
  await cdp.waitFor('window.__terms().length === 2 && window.__probe.creates.length === 2')
  await sleep(1000)
  const before = await cdp.evaluate(`(() => {
    window.__beforeTerm = window.__terms()[0]
    const creates = window.__probe.creates.filter(c => c.args[0] === ${JSON.stringify(id)})
    return { pid: creates.at(-1).result.pid, creates: window.__probe.creates.length }
  })()`)
  await stream('CLOSE', 200, 'C')
  await sleep(400)
  const sash = await cdp.evaluate(`(() => {
    const rect = document.querySelector('[role="separator"]').getBoundingClientRect()
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, cols: window.__terms()[0].cols }
  })()`)
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: sash.x, y: sash.y, button: 'left', buttons: 1, clickCount: 1 })
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: sash.x + 80, y: sash.y, button: 'left', buttons: 1 })
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: sash.x + 80, y: sash.y, button: 'left', buttons: 0, clickCount: 1 })
  await cdp.waitFor(`window.__terms()[0].cols !== ${sash.cols}`)
  results.sash = { resized: true }
  await sleep(500)
  results.beforeClose = await measure('CLOSE', 200, 'C')
  await cdp.evaluate(`document.querySelectorAll('button[aria-label^="Close terminal "]')[1].click()`)
  await cdp.waitFor('window.__terms().length === 1')
  await sleep(4000)
  results.close = await measure('CLOSE', 200, 'C')
  Object.assign(results.close, await cdp.evaluate(`(() => ({
    sameTerminal: window.__terms()[0] === window.__beforeTerm,
    beforePid: ${before.pid},
    afterPid: window.__probe.creates.filter(c => c.args[0] === ${JSON.stringify(id)}).at(-1).result.pid
  }))()`))
  if (!lifecycleOnly) {
    const size = await cdp.evaluate(`(() => {
      const term = window.__terms()[0]
      const resize = window.terminalAPI.resize
      window.__failedResize = false
      window.terminalAPI.resize = (id, cols, rows) => {
        if (!window.__failedResize) {
          window.__failedResize = true
          return Promise.reject(new Error('injected transient resize failure'))
        }
        return resize(id, cols, rows)
      }
      return { cols: term.cols, rows: term.rows, successfulCalls: window.__probe.events.length }
    })()`)
    await cdp.evaluate('window.terminalAPI.windowMaximize()')
    await cdp.evaluate(`(async () => {
      const deadline = performance.now() + 2000
      while (!window.__failedResize && performance.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5))
      if (!window.__failedResize) throw new Error('Resize failure was not exercised')
    })()`)
    await cdp.evaluate('window.terminalAPI.windowMaximize()')
    await cdp.waitFor(`window.__terms()[0].cols === ${size.cols} && window.__terms()[0].rows === ${size.rows}`)
    await sleep(150)
    if (await cdp.evaluate('window.__probe.events.length') !== size.successfulCalls) throw new Error('Restoring confirmed size unnecessarily resized the backend')
    results.rejectedResize = { restored: true, ...size }
    const fullScreenCommand = '[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);$e=[char]27;[Console]::WriteLine("保存中文🚀正常缓冲区");[Console]::Write("$e[?1049h$e[H全屏界面🚀");[Threading.Thread]::Sleep(2000);[Console]::Write("$e[H$e[2JAFTER");[Threading.Thread]::Sleep(500);[Console]::Write("$e[?1049l")\r'
    await cdp.evaluate(`window.terminalAPI.write(${JSON.stringify(id)}, ${JSON.stringify(fullScreenCommand)})`)
    await cdp.waitFor('window.__terms()[0].buffer.active.type === "alternate"')
    await cdp.evaluate('window.terminalAPI.windowMaximize()')
    await cdp.waitFor('window.__terms()[0].buffer.active.type === "normal"')
    results.fullScreen = await cdp.evaluate(`(() => ({
      normalHistoryPreserved: window.__snapshot()[0].lines.includes('保存中文🚀正常缓冲区'),
      alternateTextLeaked: window.__snapshot()[0].lines.includes('AFTER')
    }))()`)
    if (!results.fullScreen.normalHistoryPreserved || results.fullScreen.alternateTextLeaked) throw new Error('Full-screen resize damaged normal-buffer history')
    await stream('WIDE', 100, '汉字🚀')
    await sleep(400)
    await cdp.evaluate('window.terminalAPI.windowMaximize()')
    await sleep(400)
    await cdp.evaluate('window.terminalAPI.windowMaximize()')
    await waitLast('WIDE', 100)
    const wide = await measure('WIDE', 100, '汉字🚀')
    results.wide = { count: wide.count, missing: wide.missing, duplicates: wide.duplicates, malformed: wide.malformed, orphaned: wide.orphaned }
    if (wide.missing.length || wide.duplicates.length || wide.malformed.length || wide.orphaned.length) throw new Error('Wide-character resize corrupted output')
    await cdp.evaluate('window.__terms()[0].options.scrollback = 50')
    await stream('BOUND', 80, 'D')
    await sleep(400)
    await cdp.evaluate('window.terminalAPI.windowMaximize()')
    await waitLast('BOUND', 80)
    const bounded = await measure('BOUND', 80, 'D')
    results.scrollback = { missingRecent: bounded.missing.filter(i => i >= 60), malformed: bounded.malformed }
    if (results.scrollback.missingRecent.length || results.scrollback.malformed.length) throw new Error('Bounded scrollback lost recent output during resize')
  }
  results.raw = await cdp.evaluate('window.__probe')
  await writeFile(join(out, lifecycleOnly ? 'lifecycle-results.json' : 'resize-results.json'), JSON.stringify(results, null, 2))
  const brief = Object.fromEntries(['baseline', 'maximize', 'close'].filter(key => results[key]).map(key => {
    const { snapshot, malformed, ...rest } = results[key]
    return [key, { ...rest, malformedCount: malformed.length, malformedSample: malformed[0] }]
  }))
  console.log(JSON.stringify(brief, null, 2))
  if (results.baseline.missing.length || results.baseline.malformed.length || results.baseline.duplicates.length || results.baseline.orphaned.length) throw new Error('Control failed')
  if (results.maximize && (results.maximize.missing.length || results.maximize.malformed.length || results.maximize.duplicates.length || results.maximize.orphaned.length)) throw new Error('Resize corrupted continuous output')
  if (!results.close.sameTerminal || results.close.beforePid !== results.close.afterPid) throw new Error('Closing a sibling rebuilt the terminal or restarted its process')
  if (results.close.missing.length || results.close.malformed.length || results.close.duplicates.length || results.close.orphaned.length) throw new Error('Closing a sibling corrupted or interrupted output')
  console.log(lifecycleOnly ? 'Sibling close preserves continuous short-line output, terminal identity and PID.' : 'Continuous output survives resizing and sibling close with the original terminal and PID.')
} catch (error) {
  results.failure = String(error)
  try {
    results.raw = await cdp.evaluate('window.__probe')
    results.lastSnapshot = await cdp.evaluate('window.__snapshot()')
    await writeFile(join(out, lifecycleOnly ? 'lifecycle-results.json' : 'resize-results.json'), JSON.stringify(results, null, 2))
  } catch {}
  throw error
} finally {
  await run.close()
}
