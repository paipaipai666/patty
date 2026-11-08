import { TUI, type TerminalFrameProvider } from '@oh-my-pi/pi-tui/tui'
import { TranscriptContainer } from '@oh-my-pi/pi-tui/chrome/transcript-container'
import { UserMessageComponent } from '@oh-my-pi/pi-tui/chat/user-message'
import { SessionManager } from '@oh-my-pi/pi-coding-agent/session/session-manager'
import { FixtureTerminal } from './fixture-terminal'
import { TranscriptNavigationController, entriesFromBranch } from './native-navigation'

const terminal = new FixtureTerminal(data => { process.stdout.write(data) })
const ui = new TUI(terminal)
const transcript = new TranscriptContainer()
const manager = SessionManager.inMemory('D:/gate0-fixture')
let tick = 0
let acknowledged = 0
const provider: TerminalFrameProvider = {
  renderFrame({ columns, rows }) {
    const frame = { tick: ++tick, now: performance.now() }
    transcript.beginFrame(frame)
    const history = transcript.peekFinalizedBatch(columns, Math.max(1, rows - 2))
    const body = transcript.renderViewport(columns, Math.max(1, rows - 2), frame)
    return { history, viewport: [...body, '', 'draft: preserved input'] }
  },
  acknowledgeHistory(id) { transcript.acknowledgeFinalizedBatch(id); acknowledged++ },
  beginHistoryReplay() { transcript.beginReplay() },
}
ui.setFrameProvider(provider)

function append(id: string, source: string): void {
  manager.ingestReplicatedEntry({ type: 'message', id, parentId: manager.getLeafId(), timestamp: new Date().toISOString(), message: { role: 'user', content: source, timestamp: Date.now() } })
  transcript.addChild(new UserMessageComponent(source))
}

function settle(): void {
  for (let attempt = 0; attempt < 256; attempt++) {
    const before = acknowledged
    ui.renderNow()
    if (acknowledged === before) break
  }
}

function mark(frameId: string, mode: 'live' | 'browsing', viewRevision: number): void {
  const payload = Buffer.from(JSON.stringify({ frameId, mode, entryId: 'entry-000', viewRevision })).toString('base64url')
  terminal.write(`\x1b]777;patty-nav-v1;${payload}\x07`)
}

for (let index = 0; index < 450; index++) {
  append(`entry-${String(index).padStart(3, '0')}`, index === 0 ? 'OMP_NAV_QUESTION_000' : `Historical question ${index}\nResponse distance filler ${index}\nMore completed history ${index}`)
}
append('entry-live', 'OMP_NAV_LIVE_TAIL')
ui.start()
settle()
mark('live-before-seek', 'live', 1)
const navigation = new TranscriptNavigationController({ ui, entries: () => entriesFromBranch(manager.getBranch()), resumeLive: () => {} })
await navigation.seek({ entryId: 'entry-000' })
mark('seek-first', 'browsing', 2)
const anchored = navigation.getPosition()
append('entry-generated', 'OMP_NAV_GENERATED_WHILE_BROWSING')
ui.renderNow()
const afterAppend = navigation.getPosition()
if (anchored.mode !== 'browsing' || afterAppend.mode !== 'browsing' || anchored.entryId !== afterAppend.entryId || JSON.stringify(anchored.anchor) !== JSON.stringify(afterAppend.anchor)) throw new Error('Background output moved the history anchor')
await navigation.returnToLive()
settle()
mark('return-live', 'live', 3)
process.stderr.write(JSON.stringify({ event: 'report', source: 'OMP 18.13.3', entries: manager.getBranch().length, acknowledged, position: navigation.getPosition(), renderer: 'UserMessageComponent + TranscriptContainer + TUI', measured: navigation.viewport.metrics }) + '\n')
ui.stop()
