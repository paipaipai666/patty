import { describe, expect, it, vi } from 'vitest'
import { createOmpNavigationStore, useOmpNavigationStore, type NavigationTransport } from '../ompNavigationStore'
import type { NavigationReadySnapshot } from '../../../shared/ompNavigationTypes'

const { invokeMock, listenMock } = vi.hoisted(() => ({ invokeMock: vi.fn(), listenMock: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }))
vi.mock('@tauri-apps/api/event', () => ({ listen: listenMock }))

function snapshot(overrides: Partial<NavigationReadySnapshot> = {}): NavigationReadySnapshot {
  return {
    kind: 'ready', paneId: 'pane-1', runId: 'run-1', instanceId: 'instance-1', sessionId: 'session-1',
    revision: 1, scope: { scopeId: 'scope-1', controlEpoch: 1 }, branchEpoch: 0, displayEpoch: 0,
    catalogRevision: 1, position: { mode: 'live', sessionId: 'session-1', branchEpoch: 0, displayEpoch: 0, viewRevision: 0, frameId: '' },
    latestRequest: null, catalogSnapshotId: 'catalog-1', turnCount: 2, pageSize: 256,
    ...overrides
  }
}

function fixture() {
  let current = snapshot()
  const turns = [
    { entryId: 'entry-1', ordinal: 1, preview: 'First question', createdAt: 100 },
    { entryId: 'entry-2', ordinal: 2, preview: 'Second question', createdAt: 101 }
  ]
  const api: NavigationTransport = {
    snapshot: vi.fn(async () => current),
    page: vi.fn(async () => turns),
    request: vi.fn(async (_pane, _client, intent) => ({ requestId: intent.requestId })),
    release: vi.fn(async () => undefined),
    subscribe: vi.fn(async () => () => {})
  }
  return { api, turns, setSnapshot: (next: NavigationReadySnapshot) => { current = next } }
}

function deferred<T>() {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>((complete) => { resolve = complete })
  return { promise, resolve }
}

describe('OMP navigation store', () => {
  it('loads a fixed catalog and reuses it when only the native position changes', async () => {
    const { api, turns, setSnapshot } = fixture()
    const store = createOmpNavigationStore(api)
    await store.getState().start('pane-1')
    expect(store.getState().byPane['pane-1']).toMatchObject({ status: 'ready', turns, navigating: false })
    const loadedTurns = store.getState().byPane['pane-1'].turns
    setSnapshot(snapshot({ revision: 2, position: { mode: 'live', sessionId: 'session-1', branchEpoch: 0, displayEpoch: 0, viewRevision: 1, frameId: 'frame-1' }, catalogSnapshotId: 'catalog-2' }))
    await store.getState().start('pane-1')
    expect(api.page).toHaveBeenCalledTimes(1)
    expect(store.getState().byPane['pane-1'].turns).toBe(loadedTurns)
    expect(store.getState().byPane['pane-1'].snapshot?.position.frameId).toBe('frame-1')
    store.getState().stop('pane-1')
  })

  it('keeps the confirmed position until both application and terminal observation arrive', async () => {
    const { api, setSnapshot } = fixture()
    const store = createOmpNavigationStore(api)
    let requestId = ''
    vi.spyOn(api, 'request').mockImplementation(async (_pane, _client, intent) => {
      requestId = intent.requestId
      setSnapshot(snapshot({ revision: 2, latestRequest: { requestId, status: { kind: 'queued' }, observationTimedOut: false } }))
      return { requestId }
    })
    await store.getState().start('pane-1')
    await store.getState().navigate('pane-1', { kind: 'turn', entryId: 'entry-1' })
    expect(api.request).toHaveBeenCalledTimes(1)
    expect(store.getState().byPane['pane-1'].navigating).toBe(true)
    const position = { mode: 'browsing' as const, sessionId: 'session-1', branchEpoch: 0, displayEpoch: 0, viewRevision: 1, frameId: 'frame-1', entryId: 'entry-1', anchor: { partId: 'body', scalarOffset: 0 } }
    setSnapshot(snapshot({ revision: 3, position, latestRequest: { requestId, status: { kind: 'accepted', admissionId: 'admission-1' }, observationTimedOut: false } }))
    await store.getState().start('pane-1')
    expect(store.getState().byPane['pane-1'].shownPosition?.mode).toBe('live')
    setSnapshot(snapshot({ revision: 4, position, latestRequest: { requestId, status: { kind: 'applied', position, shown: false }, observationTimedOut: false } }))
    await store.getState().start('pane-1')
    expect(store.getState().byPane['pane-1'].shownPosition?.mode).toBe('live')
    setSnapshot(snapshot({ revision: 5, position, latestRequest: { requestId, status: { kind: 'applied', position, shown: true }, observationTimedOut: false } }))
    await store.getState().start('pane-1')
    expect(store.getState().byPane['pane-1'].shownPosition).toEqual(position)
    expect(store.getState().byPane['pane-1'].navigating).toBe(false)
    store.getState().stop('pane-1')
  })

  it('uses the registered Tauri catalog-page and release command contracts', async () => {
    const { turns } = fixture()
    listenMock.mockResolvedValue(() => {})
    invokeMock.mockImplementation(async (command: string) => command === 'omp_navigation_snapshot' ? snapshot() : command === 'omp_navigation_catalog_page' ? turns : undefined)
    await useOmpNavigationStore.getState().start('pane-1')
    expect(invokeMock).toHaveBeenCalledWith('omp_navigation_catalog_page', { paneId: 'pane-1', snapshotId: 'catalog-1', pageIndex: 0 })
    expect(useOmpNavigationStore.getState().byPane['pane-1'].status).toBe('ready')
    useOmpNavigationStore.getState().stop('pane-1')
    expect(invokeMock).toHaveBeenCalledWith('omp_navigation_release', expect.objectContaining({ paneId: 'pane-1', scope: { scopeId: 'scope-1', controlEpoch: 1 } }))
  })

  it('releases a loading scope and rejects its late pages after a new start', async () => {
    const { api, turns, setSnapshot } = fixture()
    const oldPage = deferred<unknown>()
    vi.spyOn(api, 'page').mockImplementationOnce(() => oldPage.promise)
    const store = createOmpNavigationStore(api)
    const oldStart = store.getState().start('pane-1')
    await vi.waitFor(() => expect(api.page).toHaveBeenCalledTimes(1))
    store.getState().stop('pane-1')
    expect(api.release).toHaveBeenCalledWith('pane-1', expect.any(String), { scopeId: 'scope-1', controlEpoch: 1 })
    setSnapshot(snapshot({ revision: 2, scope: { scopeId: 'scope-2', controlEpoch: 2 } }))
    await store.getState().start('pane-1')
    oldPage.resolve(turns)
    await oldStart
    expect(store.getState().byPane['pane-1'].snapshot?.scope).toEqual({ scopeId: 'scope-2', controlEpoch: 2 })
    expect(store.getState().byPane['pane-1'].status).toBe('ready')
    store.getState().stop('pane-1')
  })

  it('bounds resynchronization and never publishes a partial malformed catalog', async () => {
    const { api } = fixture()
    vi.spyOn(api, 'page').mockResolvedValue([{ entryId: 'entry-1', ordinal: 1, preview: 'Missing second item', createdAt: 100 }])
    const store = createOmpNavigationStore(api)
    await store.getState().start('pane-1')
    expect(api.snapshot).toHaveBeenCalledTimes(2)
    expect(api.page).toHaveBeenCalledTimes(2)
    expect(store.getState().byPane['pane-1']).toMatchObject({ status: 'error', turns: [] })
    store.getState().stop('pane-1')
  })

  it('steps repeated previous commands from the latest intent while requests are in flight', async () => {
    const { api } = fixture()
    const firstReply = deferred<unknown>()
    const secondReply = deferred<unknown>()
    const requests: Array<{ requestId: string; target: unknown }> = []
    vi.spyOn(api, 'request').mockImplementation((_pane, _client, intent) => {
      requests.push(intent)
      return requests.length === 1 ? firstReply.promise : secondReply.promise
    })
    const store = createOmpNavigationStore(api)
    await store.getState().start('pane-1')
    const first = store.getState().relative('pane-1', -1)
    const second = store.getState().relative('pane-1', -1)
    expect(requests.map((request) => request.target)).toEqual([{ kind: 'turn', entryId: 'entry-2' }, { kind: 'turn', entryId: 'entry-1' }])
    secondReply.resolve({ requestId: requests[1].requestId })
    firstReply.resolve({ requestId: requests[0].requestId })
    await Promise.all([first, second])
    store.getState().stop('pane-1')
  })

  it('drops local pending intent when the OMP instance is replaced', async () => {
    const { api, setSnapshot } = fixture()
    const store = createOmpNavigationStore(api)
    await store.getState().start('pane-1')
    await store.getState().navigate('pane-1', { kind: 'turn', entryId: 'entry-1' })
    expect(store.getState().byPane['pane-1'].navigating).toBe(true)
    setSnapshot(snapshot({ runId: 'run-2', instanceId: 'instance-2', scope: { scopeId: 'scope-2', controlEpoch: 2 } }))
    await store.getState().start('pane-1')
    expect(store.getState().byPane['pane-1'].navigating).toBe(false)
    expect(store.getState().byPane['pane-1'].shownPosition?.mode).toBe('live')
    store.getState().stop('pane-1')
  })

  it('does not let an older request failure overwrite a newer pending intent', async () => {
    const { api, setSnapshot } = fixture()
    const store = createOmpNavigationStore(api)
    await store.getState().start('pane-1')
    const refreshReply = deferred<unknown>()
    vi.spyOn(api, 'snapshot').mockImplementationOnce(() => refreshReply.promise)
    let count = 0
    let latestRequestId = ''
    vi.spyOn(api, 'request').mockImplementation(async (_pane, _client, intent) => {
      if (++count === 1) throw new Error('Old request failed')
      latestRequestId = intent.requestId
      return { requestId: intent.requestId }
    })
    const older = store.getState().navigate('pane-1', { kind: 'turn', entryId: 'entry-1' })
    await vi.waitFor(() => expect(api.snapshot).toHaveBeenCalledTimes(2))
    const newer = store.getState().navigate('pane-1', { kind: 'turn', entryId: 'entry-2' })
    const next = snapshot({ revision: 2, latestRequest: { requestId: latestRequestId, status: { kind: 'queued' }, observationTimedOut: false } })
    setSnapshot(next)
    refreshReply.resolve(next)
    await Promise.all([older, newer])
    expect(store.getState().byPane['pane-1']).toMatchObject({ navigating: true, error: null })
    store.getState().stop('pane-1')
  })

  it('rebuilds a failed event subscription when the user retries', async () => {
    const { api } = fixture()
    vi.spyOn(api, 'subscribe').mockRejectedValueOnce(new Error('Listener temporarily unavailable'))
    const store = createOmpNavigationStore(api)
    await store.getState().start('pane-1')
    expect(store.getState().byPane['pane-1']).toMatchObject({ status: 'error', error: 'Listener temporarily unavailable' })
    await store.getState().start('pane-1')
    expect(api.subscribe).toHaveBeenCalledTimes(2)
    expect(store.getState().byPane['pane-1']).toMatchObject({ status: 'ready', error: null })
    store.getState().stop('pane-1')
  })

  it('can retry a failed idle snapshot without waiting for another native event', async () => {
    const { api } = fixture()
    vi.spyOn(api, 'snapshot').mockRejectedValueOnce(new Error('Snapshot temporarily unavailable')).mockRejectedValueOnce(new Error('Snapshot temporarily unavailable'))
    const store = createOmpNavigationStore(api)
    await store.getState().start('pane-1')
    expect(store.getState().byPane['pane-1'].status).toBe('error')
    await store.getState().start('pane-1')
    expect(store.getState().byPane['pane-1']).toMatchObject({ status: 'ready', error: null })
    expect(api.subscribe).toHaveBeenCalledTimes(1)
    store.getState().stop('pane-1')
  })
})
