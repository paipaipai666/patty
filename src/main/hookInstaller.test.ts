import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as fs from 'fs'

vi.mock('electron', () => ({
  app: { isPackaged: false }
}))

vi.mock('fs', () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(() => '{}'),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  copyFileSync: vi.fn()
}))

import { ensureClaudeCodeHook, ensureCodexHook } from './hookInstaller'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ensureClaudeCodeHook', () => {
  it('installs PreToolUse, PostToolUse, and UserPromptSubmit hooks', async () => {
    await ensureClaudeCodeHook(12345)

    const calls = vi.mocked(fs.writeFileSync).mock.calls
    expect(calls.length).toBeGreaterThan(0)

    // The last write is the updated .claude/settings.json
    const lastCall = calls[calls.length - 1]
    const settings = JSON.parse(lastCall[1] as string)

    expect(settings).toHaveProperty('hooks')

    // SessionStart and SessionEnd from existing logic
    expect(settings.hooks.SessionStart).toBeDefined()
    expect(settings.hooks.SessionEnd).toBeDefined()

    // New keepalive hooks
    expect(settings.hooks.PreToolUse).toBeDefined()
    expect(settings.hooks.PreToolUse).toHaveLength(1)
    expect(settings.hooks.PreToolUse[0].matcher).toBe('')
    expect(settings.hooks.PreToolUse[0].hooks[0].args).toContain('pre_tool_use')

    expect(settings.hooks.PostToolUse).toBeDefined()
    expect(settings.hooks.PostToolUse).toHaveLength(1)
    expect(settings.hooks.PostToolUse[0].matcher).toBe('')
    expect(settings.hooks.PostToolUse[0].hooks[0].args).toContain('post_tool_use')

    expect(settings.hooks.UserPromptSubmit).toBeDefined()
    expect(settings.hooks.UserPromptSubmit).toHaveLength(1)
    expect(settings.hooks.UserPromptSubmit[0].matcher).toBe('')
    expect(settings.hooks.UserPromptSubmit[0].hooks[0].args).toContain('user_prompt_submit')
  })

  it('preserves existing hook entries when re-installing', async () => {
    // Simulate an existing settings file with a PreToolUse hook already installed
    vi.mocked(fs.readFileSync).mockReturnValueOnce(
      JSON.stringify({
        hooks: {
          PreToolUse: [
            { matcher: '', hooks: [{ type: 'command', command: 'powershell', args: ['-File', 'old.ps1', '-EventType', 'pre_tool_use'] }] }
          ]
        }
      })
    )
    // existsSync for settings path needs to return true so readFileSync is actually called
    vi.mocked(fs.existsSync).mockImplementation((p: string) => {
      if (typeof p === 'string' && p.includes('.claude/settings.json')) return true
      return false
    })

    await ensureClaudeCodeHook(12345)

    const calls = vi.mocked(fs.writeFileSync).mock.calls
    const lastCall = calls[calls.length - 1]
    const settings = JSON.parse(lastCall[1] as string)

    // Old hook should be replaced, not duplicated
    expect(settings.hooks.PreToolUse).toHaveLength(1)
  })
})

describe('ensureCodexHook', () => {
  it('includes PreToolUse/PostToolUse/UserPromptSubmit keepalive hooks', async () => {
    await ensureCodexHook()

    const calls = vi.mocked(fs.writeFileSync).mock.calls
    expect(calls.length).toBeGreaterThan(0)
    const lastCall = calls[calls.length - 1]
    const settings = JSON.parse(lastCall[1] as string)

    expect(settings.hooks.PreToolUse).toBeDefined()
    expect(settings.hooks.PreToolUse).toHaveLength(1)
    expect(settings.hooks.PostToolUse).toBeDefined()
    expect(settings.hooks.PostToolUse).toHaveLength(1)
    expect(settings.hooks.UserPromptSubmit).toBeDefined()
    expect(settings.hooks.UserPromptSubmit).toHaveLength(1)
  })
})
