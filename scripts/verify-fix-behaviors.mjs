
   
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
    const p = pending.get(m.id); pending.delete(m.id)
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
const type = (text) => send('Input.insertText', { text })
const key = async (k, vk) => {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: k, windowsVirtualKeyCode: vk })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k, windowsVirtualKeyCode: vk })
}
const enter = () => key('Enter', 13)
const items = () => ev(`(() => {
  const divs = [...document.querySelectorAll('div')].filter((d) => {
    const cs = getComputedStyle(d)
    return cs.position === 'absolute' && cs.zIndex === '30' && d.querySelector('img')
  })
  if (!divs.length) return JSON.stringify({ items: [] })
  const el = divs[0]
  const fk = Object.keys(el).find((k) => k.startsWith('__reactFiber'))
  let f = el[fk]
  while (f && !(f.memoizedProps && Array.isArray(f.memoizedProps.items))) f = f.return
  return JSON.stringify(f.memoizedProps.items.map((it) => ({
    id: it.id, bufferY: it.bufferY, slotRow: it.slotRow, slotCol: it.slotCol,
    slotCode: it.slot.charCodeAt(0).toString(16), len: it.dataUrl.length,
  })))
})()`)
const iip = (prefix, extra = '') =>
  `$b=[Convert]::ToBase64String([IO.File]::ReadAllBytes('${PNG}')); ` +
  `[Console]::Write('${prefix}' + [char]27 + ']1337;File=inline=1;width=20;height=auto:' + $b + [char]7 + '${extra.replace(/'/g, "''")}')`

await send('Page.enable'); await send('Runtime.enable')
await ev(`document.querySelector('.xterm-helper-textarea')?.focus(); 'ok'`)

console.log('A0 items:', await items())

await type('1..60 | ForEach-Object { Write-Host \"\" }'); await enter(); await sleep(1200)
await type(iip('')); await enter(); await sleep(1800)
console.log('A1 placed:', await items())


await type(`[Console]::Write([char]27 + '[2J' + [char]27 + '[3J' + [char]27 + '[H')`); await enter()
await sleep(1200)
console.log('B1 after 3J (expect []):', await items())


await type('Write-Host one'); await enter(); await sleep(400)
await type(iip('')); await enter(); await sleep(1500)
await type('Write-Host two'); await enter(); await sleep(400)
await type(iip('')); await enter(); await sleep(1500)
console.log('C1 two displays (expect 2):', await items())


const before = JSON.parse(await items())
const second = before[1]
const vpRow = JSON.parse(await ev(`JSON.stringify((document.querySelector('.xterm-viewport')?.scrollTop ?? 0) / 24)`))
const cupRow = second.slotRow - Math.round(vpRow) + 1
const dCmd =
  `[Console]::Write([char]27 + '[${cupRow};1H' + [char]27 + '[2K' + [char]27 + ']1337;File=inline=1;width=20;height=auto:' + ` +
  `[Convert]::ToBase64String([IO.File]::ReadAllBytes('${PNG}')) + [char]7)`
await type(dCmd); await enter(); await sleep(1800)
console.log('D1 after repaint (expect 2 items, id 2 relocated):', await items())
ws.close()
