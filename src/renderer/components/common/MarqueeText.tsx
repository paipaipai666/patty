import { useLayoutEffect, useRef, useState } from 'react'
import styles from './MarqueeText.module.css'

// Gap between the two copies while scrolling; MUST match `.copy + .copy`
// margin-left in MarqueeText.module.css for a seamless loop.
const LOOP_GAP_PX = 48

interface MarqueeTextProps {
  text: string
  className?: string
}

/**
 * Single-line text that stays clipped when it fits and loop-scrolls on hover
 * when it overflows its container. The container is a flex-friendly shrinkable
 * span (min-width: 0 + overflow: hidden).
 */
export function MarqueeText({ text, className }: MarqueeTextProps) {
  const outerRef = useRef<HTMLSpanElement>(null)
  const copyRef = useRef<HTMLSpanElement>(null)
  const [state, setState] = useState({ overflowing: false, pitch: 0 })

  useLayoutEffect(() => {
    const outer = outerRef.current
    const copy = copyRef.current
    if (!outer || !copy) return
    const update = () => {
      const textWidth = copy.offsetWidth
      const overflowing = textWidth > outer.clientWidth
      // Pitch = one copy + the loop gap; the inner strip holds exactly two
      // pitches, so translateX(-pitch) loops seamlessly.
      const pitch = textWidth + LOOP_GAP_PX
      setState((s) => (s.overflowing === overflowing && s.pitch === pitch ? s : { overflowing, pitch }))
    }
    update()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(update)
    ro.observe(outer)
    return () => ro.disconnect()
  }, [text])

  const { overflowing, pitch } = state
  return (
    <span
      ref={outerRef}
      className={`${styles.outer} ${overflowing ? styles.overflowing : ''}${className ? ` ${className}` : ''}`}
      style={{ '--pitch': String(pitch) } as React.CSSProperties}
    >
      <span className={styles.inner}>
        <span ref={copyRef} className={styles.copy}>
          {text}
        </span>
        {overflowing && (
          <span className={styles.copy} aria-hidden="true">
            {text}
          </span>
        )}
      </span>
    </span>
  )
}
