import { useId, useLayoutEffect, useRef, type ReactNode, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { Dismiss16Regular } from '@fluentui/react-icons'
import { focusActiveTerminal } from '../../commands/useApplicationKeyboard'
import { isComposingKey } from '../../commands/shortcuts'
import styles from './TransientPanel.module.css'

export function TransientPanel({ title, anchor, onClose, children }: {
  title: string
  anchor?: HTMLElement
  onClose: () => void
  children: ReactNode
}) {
  const id = useId()
  const panel = useRef<HTMLDivElement>(null)
  const origin = useRef(document.activeElement)
  const rect = anchor?.getBoundingClientRect()
  useLayoutEffect(() => {
    panel.current?.querySelector<HTMLButtonElement>('button')?.focus()
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !panel.current?.contains(event.target)) onClose()
    }
    const contain = (event: FocusEvent) => {
      if (event.target instanceof Node && !panel.current?.contains(event.target)) panel.current?.querySelector<HTMLButtonElement>('button')?.focus()
    }
    const resize = () => onClose()
    document.addEventListener('pointerdown', outside)
    document.addEventListener('focusin', contain)
    window.addEventListener('resize', resize)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('focusin', contain)
      window.removeEventListener('resize', resize)
      if (origin.current instanceof HTMLElement && origin.current.isConnected && origin.current !== document.body) origin.current.focus()
      else focusActiveTerminal()
    }
  }, [onClose])
  const keydown = (event: KeyboardEvent) => {
    if (isComposingKey(event.nativeEvent)) return
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onClose()
    } else if (event.key === 'Tab' && panel.current) {
      const controls = Array.from(panel.current.querySelectorAll<HTMLElement>('button:not(:disabled), select, a[href], [tabindex="0"]'))
      const index = controls.indexOf(document.activeElement instanceof HTMLElement ? document.activeElement : controls[0])
      event.preventDefault()
      controls[(index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length]?.focus()
    }
  }
  return createPortal(<div ref={panel} className={`${styles.panel} ${anchor ? styles.anchored : styles.centered}`} role="dialog" aria-modal="true" aria-labelledby={id} onKeyDown={keydown}
    style={rect ? { left: Math.max(12, Math.min(rect.left, window.innerWidth - 372)), top: Math.min(rect.bottom + 8, window.innerHeight - 160), maxHeight: Math.max(120, window.innerHeight - rect.bottom - 20) } : undefined}>
    <div className={styles.heading}><h2 id={id}>{title}</h2><button type="button" onClick={onClose} aria-label={`Close ${title.toLowerCase()}`}><Dismiss16Regular aria-hidden /></button></div>
    <div className={styles.body}>{children}</div>
  </div>, document.getElementById('root') ?? document.body)
}
