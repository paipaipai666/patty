import { describe, it, expect } from 'vitest'
import {
  perfEnabled,
  perfCounter,
  perfTimerStart,
  perfTimerEnd,
  perfMark,
  perfMeasure,
  perfReport,
  perfDump,
  perfMemoryMain
} from '../perf'

describe('perfEnabled', () => {
  it('is false when env vars are not set', () => {
    expect(perfEnabled).toBe(false)
  })
})

describe('perf functions are no-ops when disabled', () => {
  it('perfCounter does not throw', () => {
    expect(() => perfCounter('test')).not.toThrow()
  })

  it('perfTimerStart does not throw', () => {
    expect(() => perfTimerStart('test')).not.toThrow()
  })

  it('perfTimerEnd returns 0', () => {
    expect(perfTimerEnd('test')).toBe(0)
  })

  it('perfMark does not throw', () => {
    expect(() => perfMark('test')).not.toThrow()
  })

  it('perfMeasure returns 0', () => {
    expect(perfMeasure('test', 'test')).toBe(0)
  })

  it('perfReport does not throw', () => {
    expect(() => perfReport()).not.toThrow()
  })

  it('perfDump does not throw', () => {
    expect(() => perfDump()).not.toThrow()
  })

  it('perfMemoryMain does not throw', () => {
    expect(() => perfMemoryMain('test')).not.toThrow()
  })
})
