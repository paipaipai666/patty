
   
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
const type = (t) => send('Input.insertText', { text: t })
const enter = async () => {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
}
const esc = async () => {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
}
const shot = async (f) => {
  const { data } = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(f, Buffer.from(data, 'base64'))
  console.log('shot', f)
}
const measure = async (tag) => {
  const { result } = await send('Runtime.evaluate', {
    expression: `JSON.stringify((() => {
      const imgs = [...document.querySelectorAll('img[src^="data:image"]')].map((el) => {
        const r = el.getBoundingClientRect()
        return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }
      })
      return { tag: ${JSON.stringify(tag)}, imgs, last: window.__iipLast || null }
    })())`,
    returnByValue: true,
  })
  const d = JSON.parse(result.value)
  console.log(JSON.stringify(d, null, 2))
  return d
}

await send('Page.enable')
await send('Runtime.enable')
await send('Runtime.evaluate', { expression: "document.querySelector('.xterm-helper-textarea')?.focus()" })


await esc(); await sleep(150); await esc(); await sleep(150)
await type('/exit'); await enter(); await sleep(1200)

await type('cd D:\\code\\AgentNexus')
await enter()
await sleep(800)
await type('omp --resume')
await enter()
console.log('omp --resume launched…')
await sleep(5000)
await shot('output/playwright/resume-01.png')
await measure('after-resume')


await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 800, y: 500, deltaX: 0, deltaY: -400 })
await sleep(600)
await shot('output/playwright/resume-02-scrollup.png')
await measure('after-scroll-up')

await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 800, y: 500, deltaX: 0, deltaY: 400 })
await sleep(600)
await measure('after-scroll-down')

ws.close()
