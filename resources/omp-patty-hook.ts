
   

import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import type { StandardNavigation, StandardSessionManager, StandardTui } from '../integrations/omp/standard-navigation'

interface OmpWidget {
  render(width: number): string[]
  invalidate(): void
}

interface OmpUi {
  transcript?: NavigationApi
  setWidget?(key: string, factory: ((tui: StandardTui) => OmpWidget) | undefined): void
}

interface OmpExtensionContext {
  setInterval(fn: () => void, ms: number): void
  ui?: OmpUi
  sessionManager?: StandardSessionManager
  hasUI?: boolean
  mode?: string
  agent?: unknown
  cwd?: string
}

interface OmpExtensionApi {
  on(event: string, handler: (event: unknown, ctx: OmpExtensionContext) => unknown): void
}

function captureStandardTui(ctx: OmpExtensionContext): StandardTui | undefined {
  const ui = ctx.ui
  const sessionManager = ctx.sessionManager
  if (!ctx.hasUI || !ui || typeof ui.setWidget !== 'function' || !sessionManager
    || typeof sessionManager.getBranchView !== 'function' || typeof sessionManager.getSessionId !== 'function') return undefined
  let captured: StandardTui | undefined
  try {
    ui.setWidget('patty-navigation', tui => { captured = tui; return { render: () => [], invalidate() {} } })
  } catch {
    return undefined
  }
  try { ui.setWidget('patty-navigation', undefined) } catch {}
  return captured
}

export default function PattyNotifier(pi: OmpExtensionApi): void {
  const PATTY_PORT = process.env.PATTY_PORT
  const PANE_ID = process.env.PATTY_PANE_ID
  const SECRET = process.env.PATTY_HOOK_SECRET


  if (!PATTY_PORT || !PANE_ID) return

  const instanceId = randomUUID()
  let sequence = 0
  let conversationId: string | undefined
  let navigation: ReturnType<typeof startNavigationBridge> | undefined
  let standardNavigation: StandardNavigation | undefined

  const refreshListeners = new Set<() => void>()
  const subscribe = (listener: () => void): (() => void) => {
    refreshListeners.add(listener)
    return () => { refreshListeners.delete(listener) }
  }
  const refresh = (): void => { for (const listener of refreshListeners) listener() }

  for (const event of ['message_end', 'turn_end', 'session_switch', 'session_branch', 'session_compact']) {
    pi.on(event, () => { refresh() })
  }

  const origin = () => ({ processId: process.pid, sequence: ++sequence, emittedAt: Date.now(), instanceId,
    ...(conversationId ? { conversationId } : {}) })

  const hookBody = (event: string) =>
    JSON.stringify({ paneId: PANE_ID, event, source: 'omp', secret: SECRET,
      origin: origin() })

  const notifyPatty = async (event: string) => {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 1500)
    try {
      await fetch(`http://127.0.0.1:${PATTY_PORT}/hook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: hookBody(event),
        signal: controller.signal
      })
    } catch {

    } finally {
      clearTimeout(timeoutId)
    }
  }


  const notifyPattyDetached = (event: string) => {
    try {
      const child = spawn(
        'curl',
        ['-s', '-m', '3', '-X', 'POST', `http://127.0.0.1:${PATTY_PORT}/hook`, '-H', 'Content-Type: application/json', '--data-binary', '@-'],
        { detached: true, stdio: ['pipe', 'ignore', 'ignore'] }
      )
      child.stdin?.write(hookBody(event))
      child.stdin?.end()
      child.on('error', () => {})
      child.unref()
    } catch {
      void notifyPatty(event)
    }
  }

  let aliveStarted = false

  pi.on('session_start', async (_event: unknown, ctx: OmpExtensionContext) => {
    navigation?.stop()
    standardNavigation?.dispose()
    standardNavigation = undefined
    const transcript = ctx.ui?.transcript
    conversationId = ctx.ui?.transcript?.getPosition().sessionId ?? ctx.sessionManager?.getSessionId()
    await notifyPatty('session_created')
    const onSession = async (sessionId: string) => {
      const changed = conversationId !== sessionId
      conversationId = sessionId
      await notifyPatty(changed ? 'session_created' : 'alive')
    }
    if (transcript && SECRET) {
      navigation = startNavigationBridge({
        baseUrl: `http://127.0.0.1:${PATTY_PORT}`, paneId: PANE_ID, secret: SECRET,
        origin, transcript, onSession
      })
    } else if (!transcript && SECRET) {
      const tui = captureStandardTui(ctx)
      const sessionManager = ctx.sessionManager
      if (tui && sessionManager) {
        const { createStandardNavigation } = await import('../integrations/omp/standard-navigation')
        const controller = createStandardNavigation({ ui: tui, sessionManager, cwd: ctx.cwd ?? process.cwd(), subscribe })
        standardNavigation = controller
        navigation = startNavigationBridge({
          baseUrl: `http://127.0.0.1:${PATTY_PORT}`, paneId: PANE_ID, secret: SECRET,
          origin, transcript: controller, onSession
        })
      }
    }
    if (!aliveStarted) {
      aliveStarted = true

      ctx.setInterval(() => { void notifyPatty('alive') }, 5000)
    }
  })

  pi.on('session_shutdown', () => {
    navigation?.stop()
    standardNavigation?.dispose()
    standardNavigation = undefined
    notifyPattyDetached('session_deleted')
  })

  pi.on('session_stop', () => {
    void notifyPatty('idle')
  })

  pi.on('tool_call', () => {
    void notifyPatty('pre_tool_use')
  })

  pi.on('tool_approval_requested', () => {
    void notifyPatty('permission_prompt')
  })

  pi.on('auto_retry_start', () => {
    void notifyPatty('error_retry')
  })
}

interface NavigationPosition {
  mode: 'live' | 'browsing'
  sessionId: string
  branchEpoch: number
  displayEpoch: number
  viewRevision: number
  frameId: string
  entryId?: string
  anchor?: { partId: string; scalarOffset: number }
}

interface NavigationCatalog {
  sessionId: string
  branchEpoch: number
  catalogRevision: number
  turns: readonly { entryId: string; summary: string; timestamp: number }[]
}

interface NavigationApi {
  getCapabilities(): { transcriptNavigation: number; catalogSnapshot: number; nativeHistoryViewport: number; frameObservation: number }
  getCatalog(): NavigationCatalog
  getPosition(): NavigationPosition
  seek(target: { entryId: string; expectedBranchEpoch: number; expectedDisplayEpoch: number }): Promise<NavigationPosition>
  returnToLive(target?: { expectedBranchEpoch: number; expectedDisplayEpoch: number }): Promise<NavigationPosition>
  onPosition(listener: (position: NavigationPosition) => void): () => void
  onCatalog(listener: (catalog: NavigationCatalog) => void): () => void
}

interface BridgeOptions {
  baseUrl: string
  paneId: string
  secret: string
  origin(): { processId: number; sequence: number; emittedAt: number; instanceId: string; conversationId?: string }
  transcript: NavigationApi
  onSession(sessionId: string): Promise<void>
}

interface NavigationCommand {
  requestId: string
  seq: number
  sessionId: string
  branchEpoch: number
  displayEpoch: number
  remainingAdmissionTtlMs: number
  target: { kind: 'turn'; entryId: string } | { kind: 'live' }
}

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const counter = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

class NavigationHttpError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code) }
}

function parseNavigationCommand(value: unknown): NavigationCommand | null {
  if (!record(value) || typeof value.requestId !== 'string' || value.requestId.length > 128 || value.requestId.length === 0
    || !counter(value.seq) || typeof value.sessionId !== 'string' || !counter(value.branchEpoch)
    || !counter(value.displayEpoch) || !counter(value.remainingAdmissionTtlMs) || !record(value.target)) return null
  const target = value.target.kind === 'live' ? { kind: 'live' } as const
    : value.target.kind === 'turn' && typeof value.target.entryId === 'string' && value.target.entryId.length <= 512
      ? { kind: 'turn', entryId: value.target.entryId } as const : null
  return target ? { requestId: value.requestId, seq: value.seq, sessionId: value.sessionId,
    branchEpoch: value.branchEpoch, displayEpoch: value.displayEpoch,
    remainingAdmissionTtlMs: value.remainingAdmissionTtlMs, target } : null
}

export function startNavigationBridge(options: BridgeOptions): { stop(): void; done: Promise<void> } {
  const capabilities = options.transcript.getCapabilities()
  if (capabilities.transcriptNavigation !== 1 || capabilities.catalogSnapshot !== 1
    || capabilities.nativeHistoryViewport !== 1 || capabilities.frameObservation !== 1) return { stop() {}, done: Promise.resolve() }
  let stopped = false
  let token: string | null = null
  let currentSession = ''
  let receivedThrough = 0
  let pendingCatalog: NavigationCatalog | null = options.transcript.getCatalog()
  let pendingPosition: NavigationPosition | null = options.transcript.getPosition()
  let publishing: Promise<void> | null = null
  const aborters = new Set<AbortController>()
  const post = async (path: string, body: unknown, credential: string, timeout = 4000): Promise<unknown> => {
    if (stopped && path !== 'revoke') throw new Error('navigation_stopped')
    const controller = new AbortController()
    aborters.add(controller)
    const timeoutId = setTimeout(() => controller.abort(), timeout)
    try {
      const response = await fetch(`${options.baseUrl}/omp/${path}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${credential}` },
        body: JSON.stringify(body), signal: controller.signal
      })
      const value: unknown = await response.json()
      if (!response.ok) throw new NavigationHttpError(response.status, record(value) && typeof value.error === 'string' ? value.error : `navigation_http_${response.status}`)
      return value
    } finally { clearTimeout(timeoutId); aborters.delete(controller) }
  }
  const deliver = async (path: string, body: unknown, credential: string): Promise<unknown> => {
    for (;;) {
      if (stopped || token !== credential) throw new Error('navigation_stopped')
      try { return await post(path, body, credential) } catch (error) {
        if (error instanceof NavigationHttpError && error.status !== 429) throw error
        if (stopped || token !== credential) throw error
        await new Promise(resolve => setTimeout(resolve, 250))
      }
    }
  }
  const publish = (): Promise<void> => {
    if (publishing) return publishing
    publishing = (async () => {
      while (!stopped && token && (pendingCatalog || pendingPosition)) {
        const credential = token
        if (options.transcript.getPosition().sessionId !== currentSession) { token = null; return }
        const position = pendingPosition
        pendingPosition = null
        if (position) await post('event', { kind: 'position', position }, credential)
        const catalog = pendingCatalog
        pendingCatalog = null
        if (catalog) {
          const snapshotId = randomUUID()
          const pageCount = Math.max(1, Math.ceil(catalog.turns.length / 128))
          for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
            if (stopped || token !== credential) return
            await post('event', { kind: 'catalogPage', snapshotId, branchEpoch: catalog.branchEpoch,
              catalogRevision: catalog.catalogRevision, pageIndex, pageCount,
              turns: catalog.turns.slice(pageIndex * 128, (pageIndex + 1) * 128).map((turn, offset) => ({
                entryId: turn.entryId, ordinal: pageIndex * 128 + offset + 1,
                preview: turn.summary.slice(0, 600), createdAt: turn.timestamp
              })) }, credential)
          }
        }
      }
    })().finally(() => {
      publishing = null
      if (!stopped && token && (pendingCatalog || pendingPosition)) void publish().catch(() => { token = null })
    })
    return publishing
  }
  const positionUnsubscribe = options.transcript.onPosition(position => {
    pendingPosition = position
    if (currentSession && position.sessionId !== currentSession) {
      token = null
      for (const controller of aborters) controller.abort()
    }
    if (token) void publish().catch(() => { token = null })
  })
  const catalogUnsubscribe = options.transcript.onCatalog(catalog => {
    pendingCatalog = catalog
    if (token) void publish().catch(() => { token = null })
  })
  const done = (async () => {
    while (!stopped) {
      try {
        if (!token || currentSession !== options.transcript.getPosition().sessionId) {
          currentSession = options.transcript.getPosition().sessionId
          await options.onSession(currentSession)
          if (stopped) break
          const registered = await post('register', { protocolVersion: 1, paneId: options.paneId, origin: options.origin(), capabilities }, options.secret)
          if (!record(registered) || typeof registered.leaseToken !== 'string') throw new Error('invalid_registration')
          token = registered.leaseToken
          if (stopped) { await post('revoke', {}, token); token = null; break }
          receivedThrough = 0
          pendingCatalog = options.transcript.getCatalog()
          pendingPosition = options.transcript.getPosition()
        }
        await publish()
        const credential = token
        if (!credential) continue
        const polled = await post('poll', { receivedThrough }, credential, 25000)
        if (!record(polled) || polled.command === null) continue
        const command = parseNavigationCommand(polled.command)
        if (!command) throw new Error('invalid_command')
        receivedThrough = Math.max(receivedThrough, command.seq)
        if (stopped || command.sessionId !== currentSession || command.remainingAdmissionTtlMs === 0) continue
        let accepted: unknown
        const receivedAt = performance.now()
        for (;;) {
          try { accepted = await deliver('accept', { requestId: command.requestId }, credential); break } catch (error) {
            if (error instanceof NavigationHttpError && error.code === 'busy' && !stopped && performance.now() - receivedAt < command.remainingAdmissionTtlMs) {
              await new Promise(resolve => setTimeout(resolve, 25))
              continue
            }
            if (error instanceof NavigationHttpError && ['expired', 'superseded', 'cancelled'].includes(error.code)) { accepted = null; break }
            throw error
          }
        }
        if (accepted === null) continue
        if (!record(accepted) || !record(accepted.admission) || typeof accepted.admission.admissionId !== 'string'
          || accepted.admission.admissionId.length === 0 || accepted.admission.admissionId.length > 128
          || accepted.admission.requestId !== command.requestId || accepted.admission.executionBudgetMs !== 5000) throw new Error('invalid_admission')
        const admissionId = accepted.admission.admissionId
        try {
          let permission: unknown
          try { permission = await deliver('authorize', { requestId: command.requestId, admissionId }, credential) } catch (error) {
            if (error instanceof NavigationHttpError && ['superseded', 'cancelled', 'expired', 'stale_scope'].includes(error.code)) {
              await deliver('event', { kind: 'abandoned', requestId: command.requestId, admissionId }, credential)
              continue
            }
            throw error
          }
          if (!record(permission) || permission.authorized !== true || permission.executionBudgetMs !== 5000) throw new Error('invalid_authorization')
          const current = options.transcript.getPosition()
          if (stopped || current.sessionId !== command.sessionId || current.branchEpoch !== command.branchEpoch
            || current.displayEpoch !== command.displayEpoch) throw new Error('stale_display')
          const position = command.target.kind === 'live' ? await options.transcript.returnToLive({ expectedBranchEpoch: command.branchEpoch, expectedDisplayEpoch: command.displayEpoch })
            : await options.transcript.seek({ entryId: command.target.entryId,
              expectedBranchEpoch: command.branchEpoch, expectedDisplayEpoch: command.displayEpoch })
          await deliver('event', { kind: 'applied', requestId: command.requestId, admissionId, position }, credential)
        } catch (error) {
          await deliver('event', { kind: 'failed', requestId: command.requestId, admissionId,
            error: error instanceof Error ? error.message.slice(0, 200) : 'navigation_failed' }, credential)
        }
      } catch {
        token = null
        if (!stopped) await new Promise(resolve => setTimeout(resolve, 1000))
      }
    }
  })()
  return { done, stop() {
    stopped = true
    positionUnsubscribe()
    catalogUnsubscribe()
    for (const controller of aborters) controller.abort()
    if (token) void post('revoke', {}, token).catch(() => {})
  } }
}
