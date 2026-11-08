import type { ExtensionAPI } from '@oh-my-pi/pi-coding-agent/extensibility/extensions/types'
import { existsSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

export default function fixture(pi: ExtensionAPI): void {
  pi.on('session_start', (_event, ctx) => {
    let delivered = false
    const signal = resolve('desktop/browse-active')
    ctx.setInterval(() => {
      if (delivered || !existsSync(signal)) return
      delivered = true
      pi.sendMessage({ customType: 'patty-navigation-fixture', content: 'OMP_NAV_GENERATED_WHILE_BROWSING', display: true }, { triggerTurn: false })
      writeFileSync(resolve('desktop/background-ready'), ctx.sessionManager.getSessionId())
    }, 100)
  })
}
