import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import { themeRipple } from '../themeRipple'

describe('themeRipple', () => {
  let triggerFinish: () => void

  beforeEach(() => {
    document.body.innerHTML = ''
    triggerFinish = () => {}
    // themeRipple only assigns .onfinish on the returned Animation; the rest
    // of the WAAPI surface is unused here, hence the narrow double cast.
    Element.prototype.animate = function (): Animation {
      const anim = { onfinish: null as (() => void) | null }
      triggerFinish = () => { anim.onfinish?.() }
      return anim as unknown as Animation
    }
  })

  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('appends a ripple div to document.body', () => {
    themeRipple(100, 200, '#ff0000')
    const ripple = document.body.querySelector('div')
    expect(ripple).not.toBeNull()
  })

  it('sets correct CSS properties on the ripple element', () => {
    themeRipple(100, 200, '#ff0000')
    const ripple = document.body.querySelector('div')!
    const style = ripple.style
    expect(style.position).toBe('fixed')
    expect(style.left).toBe('100px')
    expect(style.top).toBe('200px')
    expect(style.background).toBe('rgb(255, 0, 0)')
    expect(style.width).toBe('20px')
    expect(style.height).toBe('20px')
    expect(style.borderRadius).toBe('50%')
    expect(style.pointerEvents).toBe('none')
    expect(style.zIndex).toBe('99999')
  })

  it('calls animate with correct keyframes and options', () => {
    const animateSpy = vi.spyOn(Element.prototype, 'animate')
    themeRipple(50, 60, '#00ff00')
    const [[keyframes, options]] = animateSpy.mock.calls as any
    expect(keyframes).toHaveLength(2)
    expect(keyframes[0].opacity).toBe(0.4)
    expect(keyframes[1].opacity).toBe(0)
    expect(options.duration).toBe(700)
    expect(options.easing).toBe('ease-out')
    expect(options.fill).toBe('forwards')
  })

  it('removes the element when animation finishes', () => {
    themeRipple(100, 200, '#0000ff')
    const ripple = document.body.querySelector('div')!
    expect(document.body.contains(ripple)).toBe(true)
    triggerFinish()
    expect(document.body.contains(ripple)).toBe(false)
  })
})
