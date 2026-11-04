import { describe, expect, it } from 'vitest'
import { observeParsing } from './parseTiming'

describe('benchmark parser timing', () => {
  it('preserves parser arguments, receiver, result and restoration', () => {
    const timings: number[] = []
    let clock = 10
    const handler = {
      prefix: 'parsed',
      parse(text: string, resume: boolean) {
        clock += 3
        return `${this.prefix}:${text}:${resume}`
      }
    }
    const restore = observeParsing({ _core: { _inputHandler: handler } }, (ms) => timings.push(ms), () => clock)
    expect(handler.parse('中', true)).toBe('parsed:中:true')
    restore()
    expect(handler.parse('next', false)).toBe('parsed:next:false')
    expect(timings).toEqual([3])
  })

  it('records synchronous work without changing parser failures', () => {
    const timings: number[] = []
    let clock = 0
    const handler = { parse() { clock = 2; throw new Error('parser failure') } }
    observeParsing({ _core: { _inputHandler: handler } }, (ms) => timings.push(ms), () => clock)
    expect(() => handler.parse()).toThrow('parser failure')
    expect(timings).toEqual([2])
  })
})
