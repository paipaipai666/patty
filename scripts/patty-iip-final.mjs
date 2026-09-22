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

await send('Page.enable')
await send('Runtime.enable')


await send('Runtime.evaluate', { expression: "document.querySelector('.xterm-helper-textarea')?.focus()" })
const ps =
  `$b=[Convert]::ToBase64String([IO.File]::ReadAllBytes('D:\\code\\terminal\\terminal-sidebar\\tmp-test-image.png')); ` +
  `[Console]::Write([char]27 + ']1337;File=inline=1;width=20;height=auto:' + $b + [char]7)`
await send('Input.insertText', { text: ps })
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
await sleep(2000)

const { result } = await send('Runtime.evaluate', {
  expression: `JSON.stringify((() => {
    const last = window.__iipLast || null
    const imgs = [...document.querySelectorAll('img')].map((el) => {
      const r = el.getBoundingClientRect()
      const cs = getComputedStyle(el)
      const inView = r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth
      return { src: (el.getAttribute('src')||'').slice(0,32),
        x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
        opacity: cs.opacity, visibility: cs.visibility, zIndex: cs.zIndex, inView }
    })
    return { last, imgs, dpr: devicePixelRatio, innerH: innerHeight }
  })())`,
  returnByValue: true,
})
console.log(result.value)
writeFileSync('output/playwright/patty-final.json', result.value)

const { data } = await send('Page.captureScreenshot', { format: 'png' })
writeFileSync('output/playwright/patty-final.png', Buffer.from(data, 'base64'))
console.log('shot output/playwright/patty-final.png')
ws.close()
