                                                                                   
const CDP_HTTP = 'http://127.0.0.1:9223'
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
  console.log('shot', file)
}
const type = (text) => send('Input.insertText', { text })
const key = async (k, vk, mods = 0) => {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: k, windowsVirtualKeyCode: vk, modifiers: mods })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k, windowsVirtualKeyCode: vk, modifiers: mods })
}
const enter = () => key('Enter', 13)

await send('Page.enable'); await send('Runtime.enable')
await ev(`document.querySelector('.xterm-helper-textarea')?.focus(); 'ok'`)


const dump = async (tag) => {
  const r = await ev(`JSON.stringify((() => {
    const imgs = [...document.querySelectorAll('img')].map((el) => {
      const b = el.getBoundingClientRect()
      return { src: (el.getAttribute('src') || '').slice(0, 24), y: Math.round(b.y), h: Math.round(b.height) }
    })
    return { tag: '${tag}', viewportScroll: document.querySelector('.xterm-viewport')?.scrollTop, imgs }
  })(), null, 1)`)
  console.log(r)
}


await key('c', 67, 2); await sleep(400)
await key('c', 67, 2); await sleep(1200)
await shot('output/playwright/resume-0-shell.png')


await type('cd D:\\code\\AgentNexus'); await enter(); await sleep(600)
await type('omp --resume 01a0c6df-d9da-7000-a29e-55cd3c4856d9'); await enter()
console.log('resuming…'); await sleep(15000)
await shot('output/playwright/resume-1-restored.png')
await dump('restored-bottom')


for (let i = 1; i <= 4; i++) {
  await key('PageUp', 33); await sleep(700)
  await shot('output/playwright/resume-2-pageup' + i + '.png')
  await dump('pageup-' + i)
}
ws.close()
