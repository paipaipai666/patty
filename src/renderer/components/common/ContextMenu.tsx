import { useEffect, useRef } from 'react'
import { useAnimatedMount } from '../../hooks/useAnimatedMount'
import styles from './ContextMenu.module.css'

export interface MenuItem {
  label: string
  action: () => void
  disabled?: boolean
  separator?: boolean
}

interface ContextMenuProps {
  show: boolean
  x: number
  y: number
  items: MenuItem[]
  onClose: () => void
}

export function ContextMenu({ show, x, y, items, onClose }: ContextMenuProps) {
  const { mounted, exiting } = useAnimatedMount(show, 120)
  const menuRef = useRef<HTMLDivElement>(null)
  const cachedItemsRef = useRef<MenuItem[]>([])

  // Keep the last non-empty items so the menu still shows content during its exit animation
  if (items.length > 0) {
    cachedItemsRef.current = items
  }
  const renderItems = items.length > 0 ? items : cachedItemsRef.current

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [onClose])

  // Adjust position if menu would overflow
  useEffect(() => {
    if (!menuRef.current) return
    const rect = menuRef.current.getBoundingClientRect()
    if (rect.right > window.innerWidth) {
      menuRef.current.style.left = `${x - rect.width}px`
    }
    if (rect.bottom > window.innerHeight) {
      menuRef.current.style.top = `${y - rect.height}px`
    }
  }, [x, y])

  // Focus first item + arrow-key navigation
  useEffect(() => {
    if (!mounted || !menuRef.current) return
    const buttons = Array.from(menuRef.current.querySelectorAll<HTMLButtonElement>('button:not([disabled])'))
    buttons[0]?.focus()

    const handleArrow = (e: KeyboardEvent) => {
      if (!menuRef.current) return
      const btns = Array.from(menuRef.current.querySelectorAll<HTMLButtonElement>('button:not([disabled])'))
      if (btns.length === 0) return
      const idx = btns.findIndex((b) => b === document.activeElement)
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        btns[(idx + 1) % btns.length].focus()
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        btns[(idx - 1 + btns.length) % btns.length].focus()
      } else if (e.key === 'Home') {
        e.preventDefault()
        btns[0].focus()
      } else if (e.key === 'End') {
        e.preventDefault()
        btns[btns.length - 1].focus()
      }
    }
    menuRef.current.addEventListener('keydown', handleArrow)
    return () => menuRef.current?.removeEventListener('keydown', handleArrow)
  }, [mounted])

  if (!mounted) return null

  return (
    <div ref={menuRef} className={`${styles.menu} ${exiting ? styles.menuExit : ''}`} style={{ left: x, top: y }} role="menu">
      {renderItems.map((item, i) =>
        item.separator ? (
          <div key={i} className={styles.separator} role="separator" />
        ) : (
          <button
            key={i}
            type="button"
            role="menuitem"
            className={styles.item}
            disabled={item.disabled}
            onClick={() => {
              item.action()
              onClose()
            }}
          >
            {item.label}
          </button>
        )
      )}
    </div>
  )
}
