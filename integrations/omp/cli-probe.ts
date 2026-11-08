import type { ExtensionAPI } from '@oh-my-pi/pi-coding-agent/extensibility/extensions/types'

export default function probe(pi: ExtensionAPI): void {
  pi.on('session_start', (_event, ctx) => {
    setTimeout(async () => {
      try {
        const navigation = ctx.ui.transcript
        if (!navigation) throw new Error('transcript_api_unavailable')
        const first = ctx.sessionManager.getBranch().find(entry => entry.type === 'message' && entry.message.role === 'user')
        if (!first) throw new Error('probe_entry_missing')
        const leafBefore = ctx.sessionManager.getLeafId()
        const catalog = navigation.getCatalog()
        if (!catalog.turns.some(turn => turn.entryId === first.id)) throw new Error('probe_catalog_missing')
        await navigation.seek({ entryId: first.id })
        const browsing = navigation.getPosition()
        const editorBefore = ctx.ui.getEditorText()
        process.stdin.emit('data', Buffer.from('你好'))
        await new Promise(resolve => setTimeout(resolve, 30))
        const inputPosition = navigation.getPosition()
        const editorAfter = ctx.ui.getEditorText()
        if (inputPosition.mode !== 'live' || inputPosition.displayEpoch <= browsing.displayEpoch || editorAfter !== editorBefore + '你好') throw new Error('probe_local_input_transaction')
        ctx.ui.setEditorText(editorBefore)
        await navigation.seek({ entryId: first.id })
        await navigation.returnToLive()
        const live = navigation.getPosition()
        const repeated = await navigation.returnToLive()
        if (repeated.viewRevision <= live.viewRevision || repeated.frameId === live.frameId) throw new Error('probe_idempotent_frame_missing')
        const leafAfter = ctx.sessionManager.getLeafId()
        const switchedPositions: string[] = []
        const stopPositions = navigation.onPosition(position => { if (position.sessionId !== live.sessionId) switchedPositions.push(position.sessionId) })
        ctx.ui.setEditorText('/new')
        process.stdin.emit('data', Buffer.from('\r'))
        const deadline = Date.now() + 5000
        while ((navigation.getPosition().sessionId === live.sessionId || switchedPositions.length === 0) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20))
        const newPosition = navigation.getPosition()
        const newCatalog = navigation.getCatalog()
        stopPositions()
        if (newPosition.sessionId === live.sessionId || newPosition.mode !== 'live' || newCatalog.sessionId !== newPosition.sessionId || newCatalog.turns.length !== 0 || !switchedPositions.includes(newPosition.sessionId)) throw new Error('probe_new_session_lifecycle')
        const report = { event: 'cli-probe', capabilities: navigation.getCapabilities(), catalogSize: catalog.turns.length, browsing, inputPosition, editorAfter, live, repeated, leafBefore, leafAfter, newPosition, newCatalogSize: newCatalog.turns.length }
        process.stderr.write(JSON.stringify(report) + '\n')
        process.exit(browsing.mode === 'browsing' && live.mode === 'live' && report.leafBefore === report.leafAfter ? 0 : 1)
      } catch (error) {
        process.stderr.write(JSON.stringify({ event: 'cli-probe-failure', error: String(error) }) + '\n')
        process.exit(1)
      }
    }, 500)
  })
}
