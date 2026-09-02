import { useState, useEffect, useCallback, useRef } from 'react'
import { useSettingsStore } from '../../store/settingsStore'
import { useAnimatedMount } from '../../hooks/useAnimatedMount'
import type { ShortcutMap } from '../../../shared/settingsTypes'
import { SshSettingsPanel } from './SshSettingsPanel'
import { AppearanceSection } from './sections/AppearanceSection'
import { TerminalSection } from './sections/TerminalSection'
import { ShortcutsSection } from './sections/ShortcutsSection'
import { LayoutSection } from './sections/LayoutSection'
import { NotificationsSection } from './sections/NotificationsSection'
import styles from './SettingsModal.module.css'

type Category = 'appearance' | 'terminal' | 'shortcuts' | 'layout' | 'notifications' | 'ssh'

const CATEGORIES: { key: Category; label: string }[] = [
  { key: 'appearance', label: 'Appearance' },
  { key: 'terminal', label: 'Terminal' },
  { key: 'shortcuts', label: 'Shortcuts' },
  { key: 'layout', label: 'Layout' },
  { key: 'notifications', label: 'Notifications' },
  { key: 'ssh', label: 'SSH' }
]

export function formatShortcut(e: KeyboardEvent): string {
  const parts: string[] = []
  if (e.ctrlKey) parts.push('Ctrl')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')
  if (e.metaKey) parts.push('Meta')
  const key = e.key
  if (!['Control', 'Alt', 'Shift', 'Meta'].includes(key)) {
    parts.push(key.length === 1 ? key.toUpperCase() : key)
  }
  return parts.join('+')
}

export function SettingsModal() {
  const settings = useSettingsStore((s) => s.settings)
  const settingsOpen = useSettingsStore((s) => s.settingsOpen)
  const closeSettings = useSettingsStore((s) => s.closeSettings)
  const updateSetting = useSettingsStore((s) => s.updateSetting)
  const settingsCategory = useSettingsStore((s) => s.settingsCategory)
  const { mounted, exiting } = useAnimatedMount(settingsOpen, 200)
  const [activeCategory, setActiveCategory] = useState<Category>('appearance')
  const [capturingShortcut, setCapturingShortcut] = useState<keyof ShortcutMap | null>(null)
  const captureRef = useRef<keyof ShortcutMap | null>(null)
  const modalRef = useRef<HTMLDivElement>(null)
  const navRef = useRef<HTMLElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const previouslyFocused = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!settingsOpen) {
      setCapturingShortcut(null)
      return
    }
    setActiveCategory(settingsCategory === 'ssh' ? 'ssh' : 'appearance')
  }, [settingsOpen, settingsCategory])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (captureRef.current) {
          setCapturingShortcut(null)
          captureRef.current = null
        } else {
          closeSettings()
        }
        return
      }

      if (captureRef.current) {
        e.preventDefault()
        e.stopPropagation()
        const combo = formatShortcut(e)
        if (combo && !['Ctrl', 'Alt', 'Shift', 'Meta'].includes(combo)) {
          updateSetting('shortcuts', { ...settings.shortcuts, [captureRef.current]: combo })
          setCapturingShortcut(null)
          captureRef.current = null
        }
      }
    },
    [closeSettings, updateSetting, settings.shortcuts]
  )

  useEffect(() => {
    if (settingsOpen) {
      window.addEventListener('keydown', handleKeyDown, true)
      return () => window.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [settingsOpen, handleKeyDown])

  // Focus trap: save/restore focus, keep Tab inside the modal
  useEffect(() => {
    if (!settingsOpen) return
    previouslyFocused.current = document.activeElement as HTMLElement | null
    const modal = modalRef.current
    if (modal) {
      const focusable = modal.querySelector<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
      focusable?.focus()
    }

    const trap = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !modalRef.current) return
      const focusables = modalRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
      if (focusables.length === 0) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', trap)
    return () => {
      window.removeEventListener('keydown', trap)
      previouslyFocused.current?.focus?.()
    }
  }, [settingsOpen])

  const startCapture = (key: keyof ShortcutMap) => {
    setCapturingShortcut(key)
    captureRef.current = key
  }

  if (!mounted) return null

  return (
    <div className={`${styles.overlay} ${exiting ? styles.overlayExit : ''}`} onMouseDown={(e) => {
      if (e.target === e.currentTarget) closeSettings()
    }}>
      <div ref={modalRef} className={`${styles.modal} ${exiting ? styles.modalExit : ''}`} role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <div className={styles.header}>
          <span id="settings-title" className={styles.title}>Settings</span>
          <button type="button" className={styles.closeBtn} onClick={closeSettings}>
            <svg width="10" height="10" viewBox="0 0 10 10">
              <path d="M0.5 0.5L9.5 9.5M9.5 0.5L0.5 9.5" stroke="currentColor" strokeWidth="1" />
            </svg>
          </button>
        </div>

        <div className={styles.body}>
          <nav className={styles.nav} ref={navRef}>
            {CATEGORIES.map((cat) => (
              <button
                type="button"
                key={cat.key}
                className={`${styles.navItem} ${activeCategory === cat.key ? styles.navItemActive : ''}`}
                onClick={() => setActiveCategory(cat.key)}
              >
                {cat.label}
              </button>
            ))}
          </nav>

          <div className={styles.content} ref={contentRef}>
            {activeCategory === 'appearance' && (
              <AppearanceSection settings={settings} updateSetting={updateSetting} />
            )}
            {activeCategory === 'terminal' && (
              <TerminalSection settings={settings} updateSetting={updateSetting} />
            )}
            {activeCategory === 'shortcuts' && (
              <ShortcutsSection
                shortcuts={settings.shortcuts}
                capturing={capturingShortcut}
                onStartCapture={startCapture}
              />
            )}
            {activeCategory === 'layout' && (
              <LayoutSection settings={settings} updateSetting={updateSetting} />
            )}
            {activeCategory === 'notifications' && (
              <NotificationsSection settings={settings} updateSetting={updateSetting} />
            )}
            {activeCategory === 'ssh' && <SshSettingsPanel />}
          </div>
        </div>
      </div>
    </div>
  )
}
