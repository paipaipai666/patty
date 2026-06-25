import { useState, useRef, useEffect } from 'react'
import { useAnimatedMount } from '../../hooks/useAnimatedMount'
import styles from './PromptDialog.module.css'

export interface PromptOptions {
  title: string
  defaultValue?: string
  onSubmit: (value: string) => void
  onCancel: () => void
}

interface PromptDialogProps {
  show: boolean
  options: PromptOptions
}

export function PromptDialog({ show, options }: PromptDialogProps) {
  const { mounted, exiting } = useAnimatedMount(show, 200)
  const [value, setValue] = useState(options.defaultValue || '')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setValue(options.defaultValue || '')
    inputRef.current?.select()
  }, [options.defaultValue])

  const handleSubmit = () => {
    options.onSubmit(value)
  }

  const handleCancel = () => {
    options.onCancel()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSubmit()
    if (e.key === 'Escape') handleCancel()
  }

  if (!mounted) return null

  return (
    <div
      className={`${styles.overlay} ${exiting ? styles.overlayExit : ''}`}
      onMouseDown={(e) => { if (e.target === e.currentTarget) handleCancel() }}
    >
      <div className={`${styles.dialog} ${exiting ? styles.dialogExit : ''}`} role="dialog" aria-modal="true" aria-label={options.title}>
        <div className={styles.title}>{options.title}</div>
        <input
          ref={inputRef}
          className={styles.input}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          autoFocus
        />
        <div className={styles.buttons}>
          <button type="button" className={styles.cancelBtn} onClick={handleCancel}>Cancel</button>
          <button type="button" className={styles.okBtn} onClick={handleSubmit}>OK</button>
        </div>
      </div>
    </div>
  )
}
