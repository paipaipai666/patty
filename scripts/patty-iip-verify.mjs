
   
import { writeFileSync } from 'node:fs'

const CDP_HTTP = 'http://127.0.0.1:9223'
const PNG = 'D:\\code\\terminal\\terminal-sidebar\\tmp-test-image.png'

const list = await (await fetch(CDP_HTTP + '/json/list')).json()
const page = list.find((t) => t.type === 'page' && t.url.includes('1420'))
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j })
let seq = 0
const pending = new Map()
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data)
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id)
    pending.delete(msg.id)
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result)
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
const shot = async (file) => {
  const { data } = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(file, Buffer.from(data, 'base64'))
  console.log('shot', file)
}
const type = (text) => send('Input.insertText', { text })
const enter = async () => {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
}
const esc = async () => {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
}
const measure = async (tag) => {
  const { result } = await send('Runtime.evaluate', {
    expression: `JSON.stringify((() => {
      const imgs = [...document.querySelectorAll('img')].map((el) => {
        const r = el.getBoundingClientRect()
        return { srcHead: (el.getAttribute('src')||'').slice(0,36),
          x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }
      })
      return { tag: ${JSON.stringify(tag)}, imgCount: imgs.length, imgs,
        slots: (document.body.innerText.match(/[\\uE000-\\uF8FF]/g) || []).length }
    })())`,
    returnByValue: true,
  })
  const data = JSON.parse(result.value)
  console.log(JSON.stringify(data, null, 2))
  return data
}

await send('Page.enable'); await send('Runtime.enable')
await send('Runtime.evaluate', { expression: `document.querySelector('.xterm-helper-textarea')?.focus()` })


await esc(); await sleep(200); await esc(); await sleep(200)
await type('/exit')
await enter()
await sleep(1500)
await shot('output/playwright/patty-f-after-exit.png')


const ps =
  `$b=[Convert]::ToBase64String([IO.File]::ReadAllBytes('${PNG}')); ` +
  `[Console]::Write([char]27 + ']1337;File=inline=1;width=20;height=auto:' + $b + [char]7)`
await type(ps)
await enter()
console.log('emitted raw IIP')
await sleep(2000)
await shot('output/playwright/patty-g-raw-iip.png')
const info = await measure('raw-iip')
writeFileSync('output/playwright/patty-overlay.json', JSON.stringify(info, null, 2))
ws.close()
