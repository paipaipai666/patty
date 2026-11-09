import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import {
  parseNavigationSnapshot,
  parseNavigationTurns,
  type NavigationPosition,
  type NavigationReadySnapshot,
  type NavigationScope,
  type NavigationTarget,
  type NavigationTurn
} from '../../shared/ompNavigationTypes'

export interface PaneNavigationState {
  status: 'loading' | 'ready' | 'unavailable' | 'error'
  snapshot: NavigationReadySnapshot | null
  turns: NavigationTurn[]
  error: string | null
  navigating: boolean
  shownPosition: NavigationPosition | null
  pendingTarget: NavigationTarget | null
}

interface NavigationIntent {
  requestId: string
  scope: NavigationScope
  target: NavigationTarget
}

export interface NavigationTransport {
  snapshot(paneId: string, clientId: string): Promise<unknown>
  page(paneId: string, snapshotId: string, pageIndex: number): Promise<unknown>
  request(paneId: string, clientId: string, intent: NavigationIntent): Promise<unknown>
  release(paneId: string, clientId: string, scope: NavigationScope): Promise<unknown>
  subscribe(listener: (payload: unknown) => void): Promise<() => void>
}

interface OmpNavigationStore {
  byPane: Record<string, PaneNavigationState>
  start(paneId: string): Promise<void>
  stop(paneId: string): void
  navigate(paneId: string, target: NavigationTarget): Promise<void>
  relative(paneId: string, direction: -1 | 1): Promise<void>
  returnLive(paneId: string): Promise<void>
}

const transport: NavigationTransport = {
  snapshot: (paneId, clientId) => invoke('omp_navigation_snapshot', { paneId, clientId }),
  page: (paneId, snapshotId, pageIndex) => invoke('omp_navigation_catalog_page', { paneId, snapshotId, pageIndex }),
  request: (paneId, clientId, intent) => invoke('omp_navigation_request', { paneId, clientId, intent }),
  release: (paneId, clientId, scope) => invoke('omp_navigation_release', { paneId, clientId, scope }),
  subscribe: (callback) => listen<unknown>('omp:navigation', (event) => callback(event.payload))
}

interface Subscription {
  paneId: string
  clientId: string
  stopped: boolean
  ready: Promise<void>
  unlisten: (() => void) | null
  refreshing: Promise<void> | null
  dirty: boolean
  snapshot: NavigationReadySnapshot | null
  pendingRequestId: string | null
  latestIntentId: string | null
  desiredTarget: NavigationTarget | null
}

function sameIdentity(a: NavigationReadySnapshot, b: NavigationReadySnapshot): boolean {
  return a.paneId === b.paneId && a.runId === b.runId && a.instanceId === b.instanceId && a.sessionId === b.sessionId
}

function samePosition(a: NavigationPosition, b: NavigationPosition): boolean {
  return a.sessionId === b.sessionId && a.branchEpoch === b.branchEpoch && a.displayEpoch === b.displayEpoch
    && a.viewRevision === b.viewRevision && a.frameId === b.frameId
}

export interface NavigationAnchor {
  mode: 'live' | 'browsing'
  entryId: string | null
}

export function navigationAnchor(state: PaneNavigationState | undefined): NavigationAnchor {
  const snapshot = state?.snapshot
  const status = snapshot?.latestRequest?.status
  if (status?.kind === 'applied' && !status.shown && snapshot && samePosition(status.position, snapshot.position)) {
    return status.position.mode === 'browsing'
      ? { mode: 'browsing', entryId: status.position.entryId }
      : { mode: 'live', entryId: null }
  }
  if (state?.pendingTarget?.kind === 'turn') return { mode: 'browsing', entryId: state.pendingTarget.entryId }
  if (state?.pendingTarget?.kind === 'live') return { mode: 'live', entryId: null }
  const shown = state?.shownPosition
  return shown?.mode === 'browsing' ? { mode: 'browsing', entryId: shown.entryId } : { mode: 'live', entryId: null }
}

function emptyPane(status: PaneNavigationState['status']): PaneNavigationState {
  return { status, snapshot: null, turns: [], error: null, navigating: false, shownPosition: null, pendingTarget: null }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : typeof error === 'string' ? error : 'Unable to synchronize conversation turns'
}

export function createOmpNavigationStore(api: NavigationTransport = transport) {
  return create<OmpNavigationStore>((set, get) => {
    const subscriptions = new Map<string, Subscription>()
    const isCurrent = (subscription: Subscription) => !subscription.stopped && subscriptions.get(subscription.paneId) === subscription
    const update = (subscription: Subscription, state: PaneNavigationState) => {
      if (isCurrent(subscription)) set((current) => ({ byPane: { ...current.byPane, [subscription.paneId]: state } }))
    }
    const release = (subscription: Subscription, scope: NavigationScope | null) => {
      if (scope) void api.release(subscription.paneId, subscription.clientId, scope).catch(() => {})
    }

    async function load(subscription: Subscription): Promise<void> {
      const snapshot = parseNavigationSnapshot(await api.snapshot(subscription.paneId, subscription.clientId))
      if (!snapshot || snapshot.paneId !== subscription.paneId) throw new Error('Invalid conversation navigation snapshot')
      if (!isCurrent(subscription)) {
        if (snapshot.kind === 'ready') release(subscription, snapshot.scope)
        return
      }
      if (snapshot.kind === 'unavailable') {
        subscription.snapshot = null
        subscription.pendingRequestId = null
        subscription.latestIntentId = null
        subscription.desiredTarget = null
        update(subscription, emptyPane('unavailable'))
        return
      }
      const previous = get().byPane[subscription.paneId]
      const previousSnapshot = previous?.snapshot
      const sameRun = previousSnapshot !== null && previousSnapshot !== undefined && sameIdentity(previousSnapshot, snapshot)
      if (sameRun && snapshot.revision < previousSnapshot.revision) return
      if (previousSnapshot && (!sameRun || previousSnapshot.branchEpoch !== snapshot.branchEpoch || previousSnapshot.displayEpoch !== snapshot.displayEpoch
        || previousSnapshot.scope?.scopeId !== snapshot.scope?.scopeId || previousSnapshot.scope?.controlEpoch !== snapshot.scope?.controlEpoch)) {
        subscription.pendingRequestId = null
        subscription.latestIntentId = null
        subscription.desiredTarget = null
      }
      subscription.snapshot = snapshot
      const reuseCatalog = sameRun && previousSnapshot.branchEpoch === snapshot.branchEpoch
        && previousSnapshot.catalogRevision === snapshot.catalogRevision && previous.turns.length === snapshot.turnCount
      const turns = reuseCatalog ? previous.turns : []
      if (!reuseCatalog) {
        const ids = new Set<string>()
        let bytes = 0
        let ordinal = 0
        const pageCount = Math.ceil(snapshot.turnCount / snapshot.pageSize)
        for (let index = 0; index < pageCount; index++) {
          const page = parseNavigationTurns(await api.page(subscription.paneId, snapshot.catalogSnapshotId, index))
          if (!isCurrent(subscription)) { release(subscription, snapshot.scope); return }
          const expected = Math.min(snapshot.pageSize, snapshot.turnCount - turns.length)
          if (!page || page.length !== expected) throw new Error('Conversation catalog changed while loading')
          for (const turn of page) {
            bytes += turn.entryId.length + turn.preview.length + 32
            if (ids.has(turn.entryId) || turn.ordinal <= ordinal || bytes > 16 * 1024 * 1024) throw new Error('Invalid conversation catalog')
            ids.add(turn.entryId)
            ordinal = turn.ordinal
            turns.push(turn)
          }
        }
      }
      if (!isCurrent(subscription)) { release(subscription, snapshot.scope); return }
      const request = snapshot.latestRequest
      if (request?.requestId === subscription.pendingRequestId && request.status.kind !== 'queued' && request.status.kind !== 'accepted') {
        subscription.pendingRequestId = null
        subscription.desiredTarget = null
      }
      const navigating = subscription.pendingRequestId !== null || request?.status.kind === 'queued' || request?.status.kind === 'accepted'
      const waiting = navigating || (request?.status.kind === 'applied' && !request.status.shown && samePosition(request.status.position, snapshot.position))
      const previousShown = sameRun && previous?.shownPosition?.branchEpoch === snapshot.branchEpoch
        && previous.shownPosition.displayEpoch === snapshot.displayEpoch ? previous.shownPosition : null
      update(subscription, {
        status: 'ready', snapshot, turns, error: null, navigating,
        shownPosition: waiting ? previousShown : snapshot.position,
        pendingTarget: subscription.desiredTarget
      })
    }

    function refresh(subscription: Subscription): Promise<void> {
      subscription.dirty = true
      if (subscription.refreshing) return subscription.refreshing
      subscription.refreshing = (async () => {
        try {
          await subscription.ready
          while (isCurrent(subscription) && subscription.dirty) {
            subscription.dirty = false
            let failure: unknown = null
            for (let attempt = 0; attempt < 2; attempt++) {
              try { await load(subscription); failure = null; break } catch (error) { failure = error }
              if (!isCurrent(subscription)) break
            }
            if (failure !== null && isCurrent(subscription)) {
              const previous = get().byPane[subscription.paneId] ?? emptyPane('error')
              update(subscription, { ...previous, status: 'error', error: message(failure), navigating: false, pendingTarget: null })
            }
          }
        } catch (error) {
          update(subscription, { ...emptyPane('error'), error: message(error) })
          if (isCurrent(subscription)) {
            subscriptions.delete(subscription.paneId)
            subscription.stopped = true
            subscription.unlisten?.()
          }
        } finally {
          subscription.refreshing = null
        }
      })()
      return subscription.refreshing
    }

    return {
      byPane: {},
      start: async (paneId) => {
        const existing = subscriptions.get(paneId)
        if (existing) return refresh(existing)
        const subscription: Subscription = {
          paneId, clientId: crypto.randomUUID(), stopped: false, ready: Promise.resolve(), unlisten: null,
          refreshing: null, dirty: false, snapshot: null, pendingRequestId: null, latestIntentId: null, desiredTarget: null
        }
        subscriptions.set(paneId, subscription)
        update(subscription, emptyPane('loading'))
        subscription.ready = Promise.resolve().then(() => api.subscribe((payload) => {
          if (typeof payload === 'object' && payload !== null && 'paneId' in payload && payload.paneId === paneId && isCurrent(subscription)) void refresh(subscription)
        })).then((unlisten) => { if (isCurrent(subscription)) subscription.unlisten = unlisten; else unlisten() })
        await refresh(subscription)
      },
      stop: (paneId) => {
        const subscription = subscriptions.get(paneId)
        if (subscription) {
          subscriptions.delete(paneId)
          subscription.stopped = true
          subscription.unlisten?.()
          release(subscription, subscription.snapshot?.scope ?? null)
        }
        set((current) => {
          const byPane = { ...current.byPane }
          delete byPane[paneId]
          return { byPane }
        })
      },
      navigate: async (paneId, target) => {
        const subscription = subscriptions.get(paneId)
        const state = get().byPane[paneId]
        const scope = state?.snapshot?.scope
        if (!subscription || !isCurrent(subscription) || state?.status !== 'ready' || !scope) return
        if (target.kind === 'turn' && !state.turns.some((turn) => turn.entryId === target.entryId)) {
          update(subscription, { ...state, error: 'This turn is no longer available' })
          return
        }
        const requestId = crypto.randomUUID()
        subscription.pendingRequestId = requestId
        subscription.latestIntentId = requestId
        subscription.desiredTarget = target
        update(subscription, { ...state, error: null, navigating: true, pendingTarget: target })
        try {
          const response = await api.request(paneId, subscription.clientId, { requestId, scope, target })
          if (!isCurrent(subscription) || subscription.pendingRequestId !== requestId) return
          if (typeof response !== 'object' || response === null || !('requestId' in response) || response.requestId !== requestId) throw new Error('Invalid navigation request acknowledgement')
          await refresh(subscription)
        } catch (error) {
          if (!isCurrent(subscription) || subscription.pendingRequestId !== requestId) return
          subscription.pendingRequestId = null
          subscription.desiredTarget = null
          await refresh(subscription)
          if (!isCurrent(subscription) || subscription.latestIntentId !== requestId) return
          const current = get().byPane[paneId]
          if (current) update(subscription, { ...current, error: message(error), navigating: false, pendingTarget: null })
        }
      },
      relative: async (paneId, direction) => {
        const subscription = subscriptions.get(paneId)
        const state = get().byPane[paneId]
        if (!subscription || state?.status !== 'ready' || !state.snapshot || state.turns.length === 0) return
        const position = state.snapshot.position
        const current = subscription.desiredTarget ?? (position.mode === 'browsing' ? { kind: 'turn', entryId: position.entryId } : { kind: 'live' })
        const index = current.kind === 'turn' ? state.turns.findIndex((turn) => turn.entryId === current.entryId) : state.turns.length
        if (index < 0) return
        const nextIndex = index + direction
        if (nextIndex < 0 || nextIndex > state.turns.length || (index === state.turns.length && direction === 1)) return
        const target: NavigationTarget = nextIndex === state.turns.length ? { kind: 'live' } : { kind: 'turn', entryId: state.turns[nextIndex].entryId }
        await get().navigate(paneId, target)
      },
      returnLive: async (paneId) => { await get().navigate(paneId, { kind: 'live' }) }
    }
  })
}

export const useOmpNavigationStore = createOmpNavigationStore()
