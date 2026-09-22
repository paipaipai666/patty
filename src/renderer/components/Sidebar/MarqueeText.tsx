import { useLayoutEffect, useRef, useState } from 'react'
import styles from './MarqueeText.module.css'


const LOOP_GAP_PX = 48

interface MarqueeTextProps {
  text: string
  className?: string
}


   
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
