import { useEffect, useState, useCallback } from 'react'
import { useWorkspaceStore } from '../store/workspaceStore'
import { useSessionStore } from '../store/sessionStore'
import { toast } from '../store/toastStore'
import type { AppCommand, CommandFocus } from './applicationCommands'
import { formatShortcut, isComposingKey, normalizeShortcut, TERMINAL_EDITING_SHORTCUTS } from './shortcuts'

export function focusActiveTerminal(): boolean {
  const state = useWorkspaceStore.getState()
  const workspace = state.workspaces.find(item => item.id === state.activeWorkspaceId) ?? state.workspaces[0]
  const pane = Array.from(document.querySelectorAll<HTMLElement>('[data-pane-id]')).find(element => element.dataset.paneId === workspace?.focusedPaneId)
  const input = pane?.querySelector<HTMLTextAreaElement>('.xterm-helper-textarea')
  const targets = [input, document.querySelector<HTMLElement>('[data-terminal-entry]'), document.querySelector<HTMLElement>('[aria-label="New terminal"]'), document.querySelector<HTMLElement>('[aria-label="Open command palette"]')]
  for (const target of targets) {
    target?.focus()
    if (target && document.activeElement === target) return true
  }
  return false
}

export function useCommandExecution() {
  const [request, setRequest] = useState<{ focus: CommandFocus; origin: Element | null } | null>(null)
  useEffect(() => {
    if (!request || request.focus === 'dialog' || document.querySelector('[aria-modal="true"]')) return
    if (request.focus === 'previous' && request.origin instanceof HTMLElement && request.origin.isConnected && request.origin !== document.body) {
      request.origin.focus()
      if (document.activeElement !== request.origin) focusActiveTerminal()
    } else {
      focusActiveTerminal()
    }
  }, [request])
  return useCallback(async (command: AppCommand, origin: Element | null = document.activeElement) => {
    if (command.disabledReason?.()) return
    try {
      const focus = await command.run(origin)
      if (focus === 'terminal') {
        const id = useSessionStore.getState().activeSessionId
        if (id) useWorkspaceStore.getState().ensureVisible(id)
      }
      setRequest({ focus, origin })
    } catch {
      toast(`Could not ${command.label.toLowerCase()}. Try again.`)
      setRequest({ focus: 'previous', origin })
    }
  }, [])
}

export function useApplicationKeyboard({ commands, blocked = false, navigateToIndex, execute }: {
  commands: AppCommand[]
  blocked?: boolean
  navigateToIndex: (index: number) => void
  execute: (command: AppCommand) => void
}) {
  useEffect(() => {
    let composing = false
    const start = () => { composing = true }
    const end = () => { composing = false }
    const keydown = (event: KeyboardEvent) => {
      if (blocked || composing || isComposingKey(event) || event.defaultPrevented || document.querySelector('[aria-modal="true"], [role="menu"]')) return
      const active = document.activeElement
      const editable = active instanceof HTMLElement && !active.closest('.xterm') && (active.isContentEditable || Boolean(active.closest('input, textarea, select, [contenteditable="true"]')))
      const combo = normalizeShortcut(formatShortcut(event))
      if (TERMINAL_EDITING_SHORTCUTS.includes(combo)) return
      const index = !editable && event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey && /^[1-9]$/.test(event.key) ? Number(event.key) - 1 : null
      const command = index === null ? commands.find(item => item.shortcut && normalizeShortcut(item.shortcut) === combo && (!editable || item.allowInEditable)) : undefined
      if (!command && index === null) return
      event.preventDefault()
      event.stopImmediatePropagation()
      if (event.repeat) return
      if (command) execute(command)
      else if (index !== null) execute({ id: 'session-index', label: 'Switch session', group: 'Navigation', description: 'Session by position', run: () => { navigateToIndex(index); return 'terminal' } })
    }
    window.addEventListener('keydown', keydown, true)
    window.addEventListener('compositionstart', start, true)
    window.addEventListener('compositionend', end, true)
    window.addEventListener('blur', end)
    return () => {
      window.removeEventListener('keydown', keydown, true)
      window.removeEventListener('compositionstart', start, true)
      window.removeEventListener('compositionend', end, true)
      window.removeEventListener('blur', end)
    }
  }, [commands, blocked, navigateToIndex, execute])
}
