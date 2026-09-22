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
  expression: `JSON.stringify([...document.querySelectorAll('img')].map(el => {
    const r = el.getBoundingClientRect()
    const p = el.parentElement
    const pr = p.getBoundingClientRect()
    const pcs = getComputedStyle(p)
    return {
      nw: el.naturalWidth, nh: el.naturalHeight, complete: el.complete,
      srcLen: (el.getAttribute('src') || '').length,
      img: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      parentZ: pcs.zIndex, parentPos: pcs.position,
      parent: { x: Math.round(pr.x), y: Math.round(pr.y), w: Math.round(pr.width), h: Math.round(pr.height) }
    }
  }))`,
  returnByValue: true,
})
console.log(result.value)
ws.close()
