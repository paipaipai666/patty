import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../shellReadiness', () => ({
  markShellReady: vi.fn()
}))

import { registerOsc7Handler } from '../osc7Handler'

function createMockTerminal() {
  const innerDispose = vi.fn()
  const registerOscHandler = vi.fn().mockReturnValue({ dispose: innerDispose })
  return {
    parser: { registerOscHandler },
    _innerDispose: innerDispose
  } as any
}

/**
 * Tests normalizeCwdFromOsc behavior through the public registerOsc7Handler API.
 * The pure function is tested indirectly by checking what onCwd receives.
 */
describe('registerOsc7Handler', () => {
  let term: ReturnType<typeof createMockTerminal>
  let onCwd: ReturnType<typeof vi.fn>

  beforeEach(() => {
    term = createMockTerminal()
    onCwd = vi.fn()
  })

  function triggerOsc7(term: any, data: string) {
    const handler = term.parser.registerOscHandler.mock.calls[0][1]
    handler(data)
  }

  it('parses file://hostname/C:/Users/foo to C:\\Users\\foo', () => {
    registerOsc7Handler(term, 's1', onCwd)
    triggerOsc7(term, 'file://MY-PC/C:/Users/foo')
    expect(onCwd).toHaveBeenCalledWith('s1', 'C:\\Users\\foo')
  })

  it('decodes percent-encoded characters', () => {
    registerOsc7Handler(term, 's1', onCwd)
    triggerOsc7(term, 'file://MY-PC/C:/Program%20Files')
    expect(onCwd).toHaveBeenCalledWith('s1', 'C:\\Program Files')
  })

  it('does not call onCwd for empty data', () => {
    registerOsc7Handler(term, 's1', onCwd)
    triggerOsc7(term, '')
    expect(onCwd).not.toHaveBeenCalled()
  })

  it('handles URL decoding errors gracefully', () => {
    registerOsc7Handler(term, 's1', onCwd)
    triggerOsc7(term, 'file://hostname/bad%2')
    expect(onCwd).toHaveBeenCalledWith('s1', 'bad%2')
  })

  it('converts forward slashes to backslashes', () => {
    registerOsc7Handler(term, 's1', onCwd)
    triggerOsc7(term, 'file://hostname/c:/users/test/path')
    expect(onCwd).toHaveBeenCalledWith('s1', 'c:\\users\\test\\path')
  })

  it('registers OSC 7 handler on the terminal parser', () => {
    registerOsc7Handler(term, 's1', onCwd)
    expect(term.parser.registerOscHandler).toHaveBeenCalledWith(7, expect.any(Function))
  })

  it('returns a disposable that calls inner dispose', () => {
    const result = registerOsc7Handler(term, 's1', onCwd)
    result.dispose()
    expect(term._innerDispose).toHaveBeenCalled()
  })
})
