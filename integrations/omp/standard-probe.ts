import { writeFile } from 'node:fs/promises'
import type { ExtensionAPI } from '@oh-my-pi/pi-coding-agent/extensibility/extensions/types'
import type { TUI } from '@oh-my-pi/pi-tui/tui'
import { standardRuntimeModules, standardRuntimeController } from './standard-probe-runtime'

export default function standardProbe(pi: ExtensionAPI): void {
  pi.on('session_start', (_event, ctx) => {
    const captures: { ui?: TUI } = {}
    ctx.ui.setWidget('omp-standard-probe', ui => { captures.ui = ui; return { render: () => [], invalidate() {} } })
    setTimeout(async () => {
      const report: Record<string, unknown> = { event: 'standard-omp-probe', bun: process.versions.bun, extensionPath: import.meta.url, preexistingTranscript: ctx.ui.transcript !== undefined }
      try {
        const ui = captures.ui
        if (!ui) throw new Error('widget_factory_did_not_receive_tui')
        const names = ['showOverlay', 'addPaintListener', 'addInputListener', 'renderNow', 'requestRender', 'injectDebugInput', 'getFocused', 'hasOverlay', 'terminal', 'children']
        report.hostMembers = Object.fromEntries(names.map(name => [name, typeof Reflect.get(ui, name)]))
        report.hostConstructor = ui.constructor.name
        report.staticRuntime = standardRuntimeModules(ui)
        const imported: Record<string, unknown> = {}
        for (const specifier of ['@oh-my-pi/pi-tui/tui', '@oh-my-pi/pi-tui/components/markdown', '@oh-my-pi/pi-tui/chat/chat-transcript-builder', '@oh-my-pi/pi-coding-agent/session/session-manager']) {
          try {
            const module = await import(specifier)
            imported[specifier] = { resolved: import.meta.resolve(specifier), exports: Object.keys(module), hostIsImportedTui: typeof module.TUI === 'function' ? ui instanceof module.TUI : undefined }
          } catch (error) { imported[specifier] = { error: String(error) } }
        }
        report.imports = imported
        const constructors = new Map<string, { name: string; setRenderTheme: string; setSourceMapping: string }>()
        const seen = new Set<object>()
        const walk = (component: object): void => {
          if (seen.has(component) || seen.size > 5000) return
          seen.add(component)
          const name = component.constructor.name
          constructors.set(name, { name, setRenderTheme: typeof Reflect.get(component, 'setRenderTheme'), setSourceMapping: typeof Reflect.get(component, 'setSourceMapping') })
          const children = Reflect.get(component, 'children')
          if (Array.isArray(children)) for (const child of children) if (typeof child === 'object' && child !== null) walk(child)
        }
        walk(ui)
        report.hostComponents = [...constructors.values()]
        report.readonlySessionMembers = Object.fromEntries(['getBranch', 'getBranchView', 'getSessionId', 'getLeafId'].map(name => [name, typeof Reflect.get(ctx.sessionManager, name)]))
        const first = ctx.sessionManager.getBranch().find(entry => entry.type === 'message' && entry.message.role === 'user')
        if (!first) throw new Error('fixed_user_entry_missing')
        const leafBefore = ctx.sessionManager.getLeafId()
        const controller = standardRuntimeController(ui, ctx)
        const frames: unknown[] = []
        const paints = ui.addPaintListener(frame => { frames.push({ alt: frame.alt, rows: frame.rows, columns: frame.columns }) })
        const catalog = controller.getCatalog()
        const browsing = await controller.seek({ entryId: first.id })
        const visible = controller.viewport.render(ui.terminal.columns).join('\n')
        if (!visible.includes('OMP_STANDARD_FIRST_QUESTION')) throw new Error('first_question_not_rendered')
        if (!visible.includes('OMP_STANDARD_FIRST_ANSWER')) throw new Error('first_answer_not_rendered')
        const live = await controller.returnToLive()
        paints()
        controller.dispose()
        report.navigation = { catalogSize: catalog.turns.length, browsing, live, leafBefore, leafAfter: ctx.sessionManager.getLeafId(), firstVisible: visible.includes('OMP_STANDARD_FIRST_QUESTION'), answerVisible: visible.includes('OMP_STANDARD_FIRST_ANSWER'), frames }
        if (browsing.mode !== 'browsing' || live.mode !== 'live' || catalog.turns.length !== 2 || ctx.sessionManager.getLeafId() !== leafBefore) throw new Error('native_navigation_failed')
        ctx.ui.setWidget('omp-standard-probe', undefined)
        report.passed = true
      } catch (error) { report.passed = false; report.error = String(error) }
      const destination = process.env.OMP_STANDARD_REPORT
      if (destination) await writeFile(destination, JSON.stringify(report, null, 2) + '\n')
      process.stderr.write(JSON.stringify(report) + '\n')
      process.exit(report.passed === true ? 0 : 1)
    }, 500)
  })
}
