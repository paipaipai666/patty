import { useEffect } from 'react'
import { useSessionStore } from '../store/sessionStore'
import { useSettingsStore } from '../store/settingsStore'
import { selectSession } from '../store/sessionLifecycle'
import { focusActiveTerminal } from '../commands/useApplicationKeyboard'
import { notificationChanges } from '../utils/desktopNotifications'
import { toast } from '../store/toastStore'

export function useDesktopNotifications(onActivate: () => void) {
  useEffect(() => {
    const api = window.terminalAPI
    if (!api.notifyAttention || !api.onDesktopActivation) return
    let alive = true
    let warned = false
    const failed = () => {
      if (alive && !warned) { warned = true; toast('Windows notifications unavailable. Check notification settings.') }
    }
    let draining = false
    let again = false
    const drain = async () => {
      if (!alive || !useSessionStore.getState().loaded) return
      if (draining) { again = true; return }
      draining = true
      try {
        do {
          again = false
          const target = await api.takeDesktopActivation()
          if (!alive || !target) continue
          onActivate()
          if (target.kind === 'session') {
            if (useSessionStore.getState().sessions.some(session => session.id === target.sessionId)) selectSession(target.sessionId)
            else toast('This session is no longer available.')
          }
          requestAnimationFrame(focusActiveTerminal)
        } while (again && alive)
      } catch { failed() }
      finally { draining = false }
    }
    const activation = api.onDesktopActivation(() => { void drain() })
    void activation.ready.then(drain).catch(failed)
    const unsubscribe = useSessionStore.subscribe((next, previous) => {
      if (next.loaded && !previous.loaded) queueMicrotask(() => { void drain() })
      const changes = notificationChanges(next, previous)
      for (const paneId of changes.dismiss) void api.dismissDesktopNotification(paneId).catch(failed)
      if (!useSettingsStore.getState().settings.desktopNotifications) return
      for (const notice of changes.notices) void api.notifyAttention(notice).catch(failed)
    })
    return () => { alive = false; unsubscribe(); activation.unsubscribe() }
  }, [onActivate])
}
