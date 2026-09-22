/**
 * Repro: omp TUI in Patty -> ask agent to read an image -> spy on the
 * overlay pipeline. Answers, per failure class:
 *   A) extractor never fires        -> omp never emitted IIP (read path)
 *   B) Image created, octet-stream  -> TIFF sniff miss (chafa payload)
 *   C) onerror                      -> data URL undecodable
 *   D) onload + DOM img but unseen  -> geometry / stacking
 */
const CDP_HTTP = 'http://127.0.0.1:9223'

const list = await (await fetch(CDP_HTTP + '/json/list')).json()
const page = list.find((t) => t.type === 'page' && t.url.includes('1420'))
if (!page) throw new Error('patty page not found')
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
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails.exception?.description ?? r.exceptionDetails))
  return r.result.value
}
const shot = async (file) => {
  const { data } = await send('Page.captureScreenshot', { format: 'png' })
  const { writeFileSync } = await import('node:fs')
  writeFileSync(file, Buffer.from(data, 'base64'))
  console.log('shot', file)
}
const type = (text) => send('Input.insertText', { text })
const key = async (k, vk) => {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: k, windowsVirtualKeyCode: vk })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k, windowsVirtualKeyCode: vk })
}
const enter = () => key('Enter', 13)

// 1) Install spy BEFORE any IIP can land.
await send('Page.enable'); await send('Runtime.enable')
await ev(`(() => {
  window.__iipSpy = { created: [], results: [], domImgs: [] }
  const O = window.Image
  function rec(src, kind) {
    const head = String(src).slice(0, 48)
    window.__iipSpy[kind === 'create' ? 'created' : 'results'].push(head)
  }
  window.Image = class extends O {
    constructor(...a) {
      super(...a)
      this.addEventListener('load', () => rec(this.src, 'load'))
      this.addEventListener('error', () => rec(this.src, 'error'))
      rec(this.src ?? '(no-src-yet)', 'create')
    }
    set src(v) { rec(v, 'setsrc'); super.src = v }
    get src() { return super.src }
  }
  return 'spy-installed'
})()`)

// 2) Focus terminal, cd, start omp.
await ev(`document.querySelector('.xterm-helper-textarea')?.focus(); 'focused'`)
await type('cd D:\\code\\AgentNexus'); await enter()
await sleep(800)
await type('omp'); await enter()
console.log('omp starting, waiting for TUI…')
await sleep(9000)
await shot('output/playwright/repro-1-omp-tui.png')

// 3) Ask the agent to read the test image with the read tool.
const ask = '请用 read 工具读取 D:\\code\\terminal\\terminal-sidebar\\tmp-test-image.png 这张图，然后用 display 把它显示出来'
await type(ask)
await enter()
console.log('request sent, waiting for agent…')
await sleep(25000)
await shot('output/playwright/repro-2-after-read.png')

// 4) Dump evidence.
const report = await ev(`JSON.stringify({
  spy: window.__iipSpy,
  iipLast: window.__iipLast ?? null,
  liveBaseY: window.__iipLiveBaseY ?? null,
  imgs: [...document.querySelectorAll('img')].map((el) => {
    const r = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    const pane = document.querySelectorAll('.xterm')[0]?.getBoundingClientRect()
    return {
      srcHead: (el.getAttribute('src') || '').slice(0, 40),
      natural: el.naturalWidth + 'x' + el.naturalHeight,
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      opacity: cs.opacity, zIndex: cs.zIndex, display: cs.display, visibility: cs.visibility,
      parentZ: getComputedStyle(el.parentElement).zIndex,
      xtermRect: pane ? { x: Math.round(pane.x), y: Math.round(pane.y) } : null,
    }
  }),
  viewportScroll: document.querySelector('.xterm-viewport')?.scrollTop ?? null,
}, null, 2)`)
console.log(report)
ws.close()
