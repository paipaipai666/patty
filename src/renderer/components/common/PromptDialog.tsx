import { useState, useRef, useEffect } from 'react'
import { useAnimatedMount } from '../../hooks/useAnimatedMount'
import styles from './PromptDialog.module.css'

export interface PromptOptions {
  title: string
  defaultValue?: string
  onSubmit: (value: string) => void
  onCancel: () => void
  /** Mask the input (password/passphrase prompts). */
  secret?: boolean
  /** Explanatory line under the title. */
  body?: string
  /** Override the OK button label. */
  okLabel?: string
  /** Confirmation-only dialog: no input, submit passes an empty string. */
  hideInput?: boolean
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
    if (show) {
      setValue(options.defaultValue || '')
      if (!options.hideInput) inputRef.current?.select()
    }
  }, [show, options.defaultValue, options.hideInput])

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
      <div
        className={`${styles.dialog} ${exiting ? styles.dialogExit : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={options.title}
        onKeyDown={handleKeyDown}
      >
        <div className={styles.title}>{options.title}</div>
        {options.body && <div className={styles.body}>{options.body}</div>}
        {!options.hideInput && (
          <input
            ref={inputRef}
            className={styles.input}
            type={options.secret ? 'password' : 'text'}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoFocus
          />
        )}
        <div className={styles.buttons}>
          <button type="button" className={styles.cancelBtn} onClick={handleCancel}>Cancel</button>
          <button type="button" className={styles.okBtn} onClick={handleSubmit} autoFocus={options.hideInput}>{options.okLabel ?? 'OK'}</button>
        </div>
      </div>
    </div>
  )
}
