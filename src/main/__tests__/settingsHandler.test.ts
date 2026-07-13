import { describe, it, expect, vi, beforeEach } from 'vitest'

const { loadJsonSync } = vi.hoisted(() => ({ loadJsonSync: vi.fn(() => ({})) }))

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/patty', getAppPath: () => '/app', isPackaged: false }
}))

vi.mock('../jsonStore', () => ({
  loadJsonSync,
  saveAtomicSync: vi.fn(),
  migrateOldDataSync: vi.fn()
}))

import { loadSettings } from '../settingsHandler'

beforeEach(() => {
  loadJsonSync.mockClear()
})

describe('settingsHandler (M9)', () => {
  it('memoizes settings reads instead of re-reading the file on every call', () => {
    loadSettings()
    loadSettings()
    // DESIRED: the on-disk read happens once and is cached. Currently each
    // call re-reads, so this fails (gets 2).
    expect(loadJsonSync).toHaveBeenCalledTimes(1)
  })
})
