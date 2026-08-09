import { useToastStore } from '../../store/toastStore'
import styles from './Toasts.module.css'

/** Bottom-right toast stack. Toasts auto-dismiss; click dismisses early. */
export function Toasts() {
  const toasts = useToastStore((s) => s.toasts)
  const dismiss = useToastStore((s) => s.dismiss)
  if (toasts.length === 0) return null
  return (
    <div className={styles.stack}>
      {toasts.map((t) => (
        <button
          key={t.id}
          type="button"
          className={`${styles.toast} ${t.kind === 'error' ? styles.toastError : ''}`}
          onClick={() => dismiss(t.id)}
          role="alert"
        >
          {t.message}
        </button>
      ))}
    </div>
  )
}
