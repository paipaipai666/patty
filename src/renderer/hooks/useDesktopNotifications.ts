import { useEffect } from 'react'
import { useSessionStore } from '../store/sessionStore'
import { useSettingsStore } from '../store/settingsStore'
import { selectSession } from '../store/sessionLifecycle'
import { focusActiveTerminal } from '../commands/useApplicationKeyboard'
import { notificationChanges } from '../utils/desktopNotifications'
import { useWorkspaceStore } from '../store/workspaceStore'
import { toast } from '../store/toastStore'
import type { AttentionNotice } from '../../shared/desktopNotifications'

export function useDesktopNotifications(onActivate: () => void) {
  useEffect(() => {
    const api = window.terminalAPI
    if (!api.notifyAttention || !api.onDesktopActivation) return
    let alive = true
    let focusTarget: string | null = null
    let cancelFocus = () => {}
    const focusWhenReady = () => {
      cancelFocus()
      const id = useSessionStore.getState().activeSessionId
      if (!id) { requestAnimationFrame(focusActiveTerminal); return }
      focusTarget = id
      let frame: number | undefined
      let timeout: ReturnType<typeof setTimeout> | undefined
      const observer = new MutationObserver(() => schedule())
      const stop = () => {
        observer.disconnect()
        if (frame !== undefined) cancelAnimationFrame(frame)
        clearTimeout(timeout)
        focusTarget = null
      }
      const check = () => {
        frame = undefined
        if (!alive || useSessionStore.getState().activeSessionId !== id) { stop(); return }
        if (document.querySelector('[aria-modal="true"]')) return
        const state = useWorkspaceStore.getState()
        const workspace = state.workspaces.find(item => item.id === state.activeWorkspaceId)
        const pane = Array.from(document.querySelectorAll<HTMLElement>('[data-pane-id]')).find(element => element.dataset.paneId === workspace?.focusedPaneId)
        const input = pane?.querySelector<HTMLTextAreaElement>('.xterm-helper-textarea')
        if (input) {
          input.focus()
          if (document.activeElement === input) stop()
        }
      }
      const schedule = () => {
        if (frame !== undefined) cancelAnimationFrame(frame)
        frame = requestAnimationFrame(check)
      }
      cancelFocus = stop
      observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'hidden', 'aria-hidden'] })
      timeout = setTimeout(stop, 15_000)
      schedule()
    }
    let warned = false
    const failed = () => {
      if (alive && !warned) { warned = true; toast('Windows notifications unavailable. Check notification settings.') }
    }
    const deliveries = new Map<string, Promise<void>>()
    const deliver = (paneId: string, dismiss: boolean, notice?: AttentionNotice) => {
      const task = (deliveries.get(paneId) ?? Promise.resolve()).then(async () => {
        if (!alive) return
        if (dismiss) await api.dismissDesktopNotification(paneId)
        if (alive && notice && useSettingsStore.getState().settings.desktopNotifications) await api.notifyAttention(notice)
      }).catch(failed).finally(() => {
        if (deliveries.get(paneId) === task) deliveries.delete(paneId)
      })
      deliveries.set(paneId, task)
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
          focusWhenReady()
        } while (again && alive)
      } catch { failed() }
      finally { draining = false }
    }
    const activation = api.onDesktopActivation(() => { void drain() })
    void activation.ready.then(drain).catch(failed)
    const unsubscribe = useSessionStore.subscribe((next, previous) => {
      if (focusTarget && next.activeSessionId !== focusTarget) cancelFocus()
      if (next.loaded && !previous.loaded) queueMicrotask(() => { void drain() })
      const changes = notificationChanges(next, previous)
      const notices = new Map(changes.notices.map(notice => [notice.paneId, notice]))
      const dismiss = new Set(changes.dismiss)
      for (const paneId of new Set([...dismiss, ...notices.keys()])) deliver(paneId, dismiss.has(paneId), notices.get(paneId))
    })
    return () => { alive = false; cancelFocus(); unsubscribe(); activation.unsubscribe() }
  }, [onActivate])
}
