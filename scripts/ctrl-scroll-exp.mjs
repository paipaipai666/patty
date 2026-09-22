/**
 * Controlled scroll experiment, plain pwsh (no TUI):
 *   exit omp -> print N blank lines (force baseY>0) -> emit raw IIP ->
 *   measure img position vs (bufferY-baseY)*cellH -> wheel-scroll, re-measure.
 * Prediction with current code (top = (bufferY-baseY)*cellH - scrollTop and
 * the xterm invariant scrollTop == baseY*cellH): img sits -scrollTop too high.
 */
const CDP_HTTP = 'http://127.0.0.1:9223'
const PNG = 'D:\\code\\terminal\\terminal-sidebar\\tmp-test-image.png'

const list = await (await fetch(CDP_HTTP + '/json/list')).json()
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
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails))
  return r.result?.value
}
const shot = async (file) => {
  const { data } = await send('Page.captureScreenshot', { format: 'png' })
  const { writeFileSync } = await import('node:fs')
  writeFileSync(file, Buffer.from(data, 'base64'))
}
const type = (text) => send('Input.insertText', { text })
const key = async (k, vk) => {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: k, windowsVirtualKeyCode: vk })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k, windowsVirtualKeyCode: vk })
}
const enter = () => key('Enter', 13)

await send('Page.enable'); await send('Runtime.enable')

// Fresh shell: exit whatever is running (omp or pwsh). PTY auto-restarts pwsh.
await ev(`document.querySelector('.xterm-helper-textarea')?.focus(); 'ok'`)
await type('exit'); await enter()
await sleep(2500)

// Push 60 blank lines so the buffer scrolls (baseY > 0 guaranteed).
await type('1..60 | ForEach-Object { Write-Host \"\" }')
await enter()
await sleep(1200)

// Emit a raw IIP at the current cursor (visible bottom row of the viewport).
const ps =
  `$b=[Convert]::ToBase64String([IO.File]::ReadAllBytes('${PNG}')); ` +
  `[Console]::Write([char]27 + ']1337;File=inline=1;width=20;height=auto:' + $b + [char]7)`
await type(ps); await enter()
await sleep(2500)
await shot('output/playwright/ctrl-1-emitted.png')

const sample = () => ev(`(() => {
  const vp = document.querySelector('.xterm-viewport')
  const img = [...document.querySelectorAll('img')].at(-1)
  const pane = [...document.querySelectorAll('div')].find((d) => d.className.includes && String(d.className).includes('pane'))
  const r = img?.getBoundingClientRect()
  const pr = pane?.getBoundingClientRect()
  const cellH = r ? r.height / 17 : null
  const derivedBaseY = vp && cellH ? vp.scrollTop / cellH : null
  return JSON.stringify({
    scrollTop: vp?.scrollTop,
    cellH,
    derivedBaseY,
    imgY_inPane: r && pr ? +(r.y - pr.y).toFixed(1) : null,
    imgH: r?.height,
    iipLast: window.__iipLast ?? null,
  }, null, 1)
})()`)

console.log('emitted:   ', await sample())

// Wheel up 2 notches, then down 2.
const rect = JSON.parse(await ev(`JSON.stringify(document.querySelector('.xterm').getBoundingClientRect())`))
const cx = Math.round(rect.x + rect.width / 2), cy = Math.round(rect.y + rect.height / 2)
for (let i = 0; i < 2; i++) { await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: cx, y: cy, deltaX: 0, deltaY: -120 }); await sleep(150) }
console.log('wheel-up:  ', await sample())
await shot('output/playwright/ctrl-2-wheelup.png')
for (let i = 0; i < 2; i++) { await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: cx, y: cy, deltaX: 0, deltaY: 120 }); await sleep(150) }
console.log('wheel-down:', await sample())
ws.close()
