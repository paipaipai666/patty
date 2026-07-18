import { describe, it, expect, vi, beforeAll } from 'vitest'

describe('opencode-patty-plugin', () => {
  type PattyNotifierFn = (ctx: {
    project: string
    directory: string
    $?: unknown
  }) => Promise<{ event: (e: { event: { type: string; properties?: Record<string, any> } }) => Promise<void> }>

  let PattyNotifier: PattyNotifierFn

  beforeAll(async () => {
    process.env.PATTY_PORT = '12345'
    process.env.PATTY_PANE_ID = 'test-pane'
    const mod = await import('../../../resources/opencode-patty-plugin')
    PattyNotifier = mod.PattyNotifier as unknown as PattyNotifierFn
  })

  it('returns an object with an event handler', async () => {
    const plugin = await PattyNotifier({ project: '', directory: '', $: {} })
    expect(plugin).toHaveProperty('event')
    expect(typeof plugin.event).toBe('function')
  })

  it('handles session.created and session.deleted without error', async () => {
    const plugin = await PattyNotifier({ project: '', directory: '', $: {} })
    await expect(plugin.event({ event: { type: 'session.created' } })).resolves.toBeUndefined()
    await expect(plugin.event({ event: { type: 'session.deleted' } })).resolves.toBeUndefined()
  })

  it('starts and stops alive timer for session lifecycle', async () => {
    vi.useFakeTimers()
    const plugin = await PattyNotifier({ project: '', directory: '', $: {} })

    // Spies: the plugin calls fetch('http://127.0.0.1:12345/hook', ...)
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.resolve(new Response(null, { status: 200 }))
    )

    await plugin.event({ event: { type: 'session.created' } })

    // Should have sent session_created
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(fetchSpy.mock.calls[0][1]?.body).toContain('session_created')
    fetchSpy.mockClear()

    // Advance 5 seconds — alive should fire
    vi.advanceTimersByTime(5000)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(fetchSpy.mock.calls[0][1]?.body).toContain('alive')
    fetchSpy.mockClear()

    // session.deleted should stop the timer
    await plugin.event({ event: { type: 'session.deleted' } })
    fetchSpy.mockClear()

    // Advance 5 more seconds — no new alive
    vi.advanceTimersByTime(5000)
    expect(fetchSpy).not.toHaveBeenCalled()

    vi.useRealTimers()
    fetchSpy.mockRestore()
  })

  it('returns empty object when env vars are missing', async () => {
    delete process.env.PATTY_PORT
    const mod = await import('../../../resources/opencode-patty-plugin')
    const Notifier = mod.PattyNotifier as unknown as PattyNotifierFn
    const plugin = await Notifier({ project: '', directory: '', $: {} })
    expect(plugin).toEqual({})
    process.env.PATTY_PORT = '12345'
  })
})
