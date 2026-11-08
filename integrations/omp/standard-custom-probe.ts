import * as coding from '@oh-my-pi/pi-coding-agent'
import * as tuiSdk from '@oh-my-pi/pi-tui'
import { writeFile } from 'node:fs/promises'
import type { ExtensionAPI } from '@oh-my-pi/pi-coding-agent/extensibility/extensions/types'

export default function standardCustomProbe(pi: ExtensionAPI): void {
  pi.on('session_start', (_event, ctx) => {
    setTimeout(async () => {
      const report: Record<string, unknown> = {
        event: 'standard-custom-probe', bun: process.versions.bun,
        codingExports: Object.keys(coding), tuiExports: Object.keys(tuiSdk),
        codingMembers: Object.fromEntries(['Markdown', 'Container', 'ChatTranscriptBuilder', 'UserMessageComponent', 'AssistantMessageComponent', 'ToolExecutionComponent', 'theme', 'getMarkdownTheme'].map(name => [name, typeof Reflect.get(coding, name)])),
        tuiMembers: Object.fromEntries(['Markdown', 'Container', 'ChatTranscriptBuilder', 'theme', 'getMarkdownTheme'].map(name => [name, typeof Reflect.get(tuiSdk, name)]))
      }
      try {
        const before = { session: ctx.sessionManager.getSessionId(), leaf: ctx.sessionManager.getLeafId(), count: ctx.sessionManager.getBranch().length }
        const abort = new AbortController()
        let rendered = 0
        let disposed = 0
        let done: ((result: string) => void) | undefined
        const uiResult = ctx.ui.custom<string>((tui, _theme, _keys, finish) => {
          done = finish
          report.customHost = Object.fromEntries(['showOverlay', 'addPaintListener', 'addInputListener', 'renderNow', 'requestRender', 'injectDebugInput', 'getFocused', 'hasOverlay', 'terminal'].map(name => [name, typeof Reflect.get(tui, name)]))
          return {
            render(width: number) { rendered++; return ['STANDARD_CUSTOM_NATIVE_HISTORY'.slice(0, width)] },
            invalidate() {},
            dispose() { disposed++ }
          }
        }, { overlay: true, overlayOptions: { fullscreen: true, width: '100%', maxHeight: '100%', row: 0, col: 0 }, signal: abort.signal, onHandle: handle => { report.handleMembers = Object.fromEntries(['hide', 'isHidden', 'setHidden', 'focus', 'unfocus'].map(name => [name, typeof Reflect.get(handle, name)])) } })
        await new Promise(resolve => setTimeout(resolve, 300))
        done?.('closed')
        report.result = await uiResult
        report.lifecycle = { rendered, disposed }
        report.branch = { before, after: { session: ctx.sessionManager.getSessionId(), leaf: ctx.sessionManager.getLeafId(), count: ctx.sessionManager.getBranch().length } }
        report.passed = rendered > 0 && disposed === 1 && before.leaf === ctx.sessionManager.getLeafId()
      } catch (error) { report.passed = false; report.error = String(error) }
      if (process.env.OMP_STANDARD_CUSTOM_REPORT) await writeFile(process.env.OMP_STANDARD_CUSTOM_REPORT, JSON.stringify(report, null, 2) + '\n')
      process.stderr.write(JSON.stringify(report) + '\n')
      process.exit(report.passed === true ? 0 : 1)
    }, 400)
  })
}
