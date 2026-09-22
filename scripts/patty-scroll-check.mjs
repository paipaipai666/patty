import { writeFileSync } from 'node:fs'

const CDP = 'http://127.0.0.1:9223'
const list = await (await fetch(CDP + '/json/list')).json()
const page = list.find((t) => t.type === 'page' && t.url.includes('1420'))
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j })
let seq = 0
const pending = new Map()
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) {
    const p = pending.get(m.id)
    pending.delete(m.id)
    m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result)
  }
}
const send = (method, params = {}) => {
  const id = ++seq
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
  })
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const evalJs = async (expression) => {
  const { result } = await send('Runtime.evaluate', { expression, returnByValue: true })
  return result.value
}
const type = (t) => send('Input.insertText', { text: t })
const enter = async () => {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
}

await send('Page.enable')
await send('Runtime.enable')
await send('Runtime.evaluate', { expression: "document.querySelector('.xterm-helper-textarea')?.focus()" })

// Fill the buffer so scrolling is possible
await type('1..80 | ForEach-Object { "line $_" }')
await enter()
await sleep(2000)

// IIP
const ps =
  `$b=[Convert]::ToBase64String([IO.File]::ReadAllBytes('D:\\code\\terminal\\terminal-sidebar\\tmp-test-image.png')); ` +
  `[Console]::Write([char]27 + ']1337;File=inline=1;width=20;height=auto:' + $b + [char]7)`
await type(ps)
await enter()
await sleep(1500)

const snap = async (tag) => {
  const v = await evalJs(`JSON.stringify((() => {
    const img = document.querySelector('img[src^="data:image"]')
    const r = img ? img.getBoundingClientRect() : null
    const vp = document.querySelector('.xterm-viewport')
    return {
      tag: ${JSON.stringify(tag)},
      imgY: r ? Math.round(r.y) : null,
      scrollTop: vp ? vp.scrollTop : null,
      scrollH: vp ? vp.scrollHeight : null,
      clientH: vp ? vp.clientHeight : null,
      liveBaseY: window.__iipLiveBaseY ?? null,
      tick: window.__iipTick ?? null,
    }
  })())`)
  console.log(tag, v)
  return JSON.parse(v)
}

const before = await snap('before')

// Scroll via the actual viewport element
await evalJs(`(() => { const vp = document.querySelector('.xterm-viewport'); vp.scrollTop = Math.max(0, vp.scrollTop - 400); return vp.scrollTop })()`)
await sleep(500)
const up = await snap('up')

await evalJs(`(() => { const vp = document.querySelector('.xterm-viewport'); vp.scrollTop = vp.scrollHeight; return vp.scrollTop })()`)
await sleep(500)
const bottom = await snap('bottom')

const { data } = await send('Page.captureScreenshot', { format: 'png' })
writeFileSync('output/playwright/scroll-live.png', Buffer.from(data, 'base64'))
writeFileSync('output/playwright/scroll-metrics.json', JSON.stringify({ before, up, bottom }, null, 2))
ws.close()
