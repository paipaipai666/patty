import { describe, it, expect, vi, beforeEach } from 'vitest'

import { useToastStore, toast } from '../toastStore'

beforeEach(() => {
  useToastStore.setState({ toasts: [] })
})

describe('push', () => {
  it('adds a toast with auto-generated id', () => {
    useToastStore.getState().push('hello')
    const items = useToastStore.getState().toasts
    expect(items).toHaveLength(1)
    expect(items[0].id).toEqual(expect.any(Number))
    expect(items[0].message).toBe('hello')
  })

  it('defaults kind to error', () => {
    useToastStore.getState().push('oops')
    expect(useToastStore.getState().toasts[0].kind).toBe('error')
  })

  it('accepts optional kind', () => {
    useToastStore.getState().push('info', 'info')
    expect(useToastStore.getState().toasts[0].kind).toBe('info')
  })
})

describe('dismiss', () => {
  it('removes a toast by id', () => {
    useToastStore.getState().push('test')
    const id = useToastStore.getState().toasts[0].id

    useToastStore.getState().dismiss(id)

    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('does nothing for non-existent id', () => {
    useToastStore.getState().push('test')
    useToastStore.getState().dismiss(999)
    expect(useToastStore.getState().toasts).toHaveLength(1)
  })
})

describe('toast convenience function', () => {
  it('calls push on the store', () => {
    const pushSpy = vi.spyOn(useToastStore.getState(), 'push')
    toast('from helper')
    expect(pushSpy).toHaveBeenCalledWith('from helper', 'error')
  })
})

describe('auto-dismiss', () => {
  it('removes toast after 4500ms', () => {
    vi.useFakeTimers()
    useToastStore.getState().push('auto')
    expect(useToastStore.getState().toasts).toHaveLength(1)

    vi.advanceTimersByTime(4500)
    expect(useToastStore.getState().toasts).toHaveLength(0)
    vi.useRealTimers()
  })
})
