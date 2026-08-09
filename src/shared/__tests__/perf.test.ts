import { describe, it, expect } from 'vitest'
import { perfEnabled, perfMark, perfMeasure } from '../perf'

describe('perfEnabled', () => {
  it('is false when env vars are not set', () => {
    expect(perfEnabled).toBe(false)
  })
})

describe('perf functions are no-ops when disabled', () => {
  it('perfMark does not throw', () => {
    expect(() => perfMark('test')).not.toThrow()
  })

  it('perfMeasure returns 0', () => {
    expect(perfMeasure('test', 'test')).toBe(0)
  })
})
