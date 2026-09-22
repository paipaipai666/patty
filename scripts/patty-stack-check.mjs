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
await send('Runtime.enable')
const { result } = await send('Runtime.evaluate', {
  expression: `JSON.stringify((() => {
    const img = document.querySelector('img[src^="data:image"]')
    if (!img) return { err: 'no img' }
    const chain = []
    let el = img
    while (el && el !== document.body) {
      const cs = getComputedStyle(el)
      chain.push({
        tag: el.tagName,
        cls: (el.className || '').toString().slice(0, 40),
        z: cs.zIndex,
        pos: cs.position,
        pe: cs.pointerEvents,
      })
      el = el.parentElement
    }
    const xterm = document.querySelector('.xterm')
    const xcs = xterm ? getComputedStyle(xterm) : null
    // What is the topmost element at the image center?
    const r = img.getBoundingClientRect()
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
    return {
      chain,
      xterm: xterm ? { z: xcs.zIndex, pos: xcs.position, cls: xterm.className } : null,
      hit: hit ? { tag: hit.tagName, cls: (hit.className || '').toString().slice(0, 50) } : null,
    }
  })())`,
  returnByValue: true,
})
console.log(result.value)
ws.close()
