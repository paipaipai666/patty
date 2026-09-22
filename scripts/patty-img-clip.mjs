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

await send('Page.enable')
await send('Runtime.enable')
const { result } = await send('Runtime.evaluate', {
  expression: `JSON.stringify((() => {
    const img = document.querySelector('img[src^="data:image"]')
    if (!img) return null
    const r = img.getBoundingClientRect()
    return { x: r.x, y: r.y, width: r.width, height: r.height, dpr: devicePixelRatio }
  })())`,
  returnByValue: true,
})
const box = JSON.parse(result.value)
console.log('box', box)
const clip = {
  x: Math.max(0, box.x - 4),
  y: Math.max(0, box.y - 4),
  width: Math.min(box.width + 8, 800),
  height: Math.min(box.height + 8, 600),
  scale: 1,
}
const { data } = await send('Page.captureScreenshot', { format: 'png', clip })
writeFileSync('output/playwright/patty-img-clip.png', Buffer.from(data, 'base64'))
console.log('wrote output/playwright/patty-img-clip.png', clip)
ws.close()
