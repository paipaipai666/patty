import { useEffect, useState } from 'react'
import type { CommandSnapshot } from '../../shared/commandTypes'

export function useCommandState(sessionId: string | null) {
  const [result, setResult] = useState<{ id: string; state: CommandSnapshot | null } | null>(null)
  useEffect(() => {
    const request = window.terminalAPI?.commandStateSnapshot
    if (!request || !sessionId) return
    let cancelled = false
    let polling = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const refresh = async () => {
      if (cancelled || polling || document.hidden) return
      polling = true
      try {
        const state = await request(sessionId)
        if (!cancelled) setResult({ id: sessionId, state })
      } catch {
        if (!cancelled) setResult({ id: sessionId, state: null })
      } finally {
        polling = false
        if (!cancelled && !document.hidden) timer = setTimeout(() => { void refresh() }, 250)
      }
    }
    const visibility = () => { clearTimeout(timer); if (!document.hidden) void refresh() }
    document.addEventListener('visibilitychange', visibility)
    void refresh()
    return () => { cancelled = true; clearTimeout(timer); document.removeEventListener('visibilitychange', visibility) }
  }, [sessionId])
  return result?.id === sessionId ? result.state : null
}
