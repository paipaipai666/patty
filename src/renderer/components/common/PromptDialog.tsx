import { useState, useRef, useEffect } from 'react'
import styles from './PromptDialog.module.css'

export interface PromptOptions {
  title: string
  defaultValue?: string
  onSubmit: (value: string) => void
  onCancel: () => void
}

interface PromptDialogProps {
  options: PromptOptions
}

export function PromptDialog({ options }: PromptDialogProps) {
  const [value, setValue] = useState(options.defaultValue || '')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.select()
  }, [])

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

  return (
    <div className={styles.overlay}>
      <div className={styles.dialog}>
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
          <button className={styles.cancelBtn} onClick={handleCancel}>Cancel</button>
          <button className={styles.okBtn} onClick={handleSubmit}>OK</button>
        </div>
      </div>
    </div>
  )
}
