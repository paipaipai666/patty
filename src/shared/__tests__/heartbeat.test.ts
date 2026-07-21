import { describe, it, expect } from 'vitest'
import { getHeartbeatConfig } from '../heartbeat'

describe('getHeartbeatConfig', () => {
  it('returns config for opencode', () => {
    expect(getHeartbeatConfig('opencode')).toEqual({ timeoutMs: 8000 })
  })

  it('returns config for claude-code', () => {
    expect(getHeartbeatConfig('claude-code')).toEqual({ timeoutMs: 600000 })
  })

  it('returns config for codex', () => {
    expect(getHeartbeatConfig('codex')).toEqual({ timeoutMs: 600000 })
  })

  it('returns undefined for unknown source', () => {
    expect(getHeartbeatConfig('unknown')).toBeUndefined()
  })

  it('returns undefined for null', () => {
    expect(getHeartbeatConfig(null)).toBeUndefined()
  })

  it('returns undefined for undefined', () => {
    expect(getHeartbeatConfig(undefined)).toBeUndefined()
  })
})
