import type { SshProfile, SshTarget } from '../../shared/settingsTypes'
import type { SplitDirection } from '../../shared/paneTypes'
import { useSessionStore } from './sessionStore'
import { useWorkspaceStore, getFocusedSessionId } from './workspaceStore'

/**
 * Session lifecycle orchestration — the ONLY place where sessionStore and
 * workspaceStore operations are paired. UI code must call these functions
 * instead of combining addSession/createWorkspace/removeSession/
 * removeSessionEverywhere by hand: the pairing used to live at every call
 * site and already produced a real bug (the collection path created a session
 * with no workspace, no pane and no PTY). REVIEW.md P1-6.
 *
 * Kill ownership: sessionStore.removeSession kills the PTY; never call
 * terminalAPI.kill around these functions.
 */

export interface CreateTerminalOptions {
  cwd?: string
  shell?: string
  collectionId?: string | null
  title?: string
  ssh?: SshTarget | null
}

/** Create a session and mount it in a (new or active) workspace. */
export function createTerminal(opts: CreateTerminalOptions = {}): string {
  const id = useSessionStore.getState().addSession(opts)
  useWorkspaceStore.getState().createWorkspace(id, opts.collectionId ?? null)
  return id
}

/** Create an SSH session from a saved profile. */
export function createSshTerminal(profile: SshProfile): string {
  return createTerminal({
    shell: 'ssh',
    title: profile.name,
    ssh: {
      host: profile.host,
      port: profile.port,
      user: profile.user,
      identityFile: profile.identityFile
    }
  })
}

/** "New Terminal Here" (collection context menu): pick a folder, then create
 *  and eagerly mount the session in the collection. */
export async function createTerminalInCollection(
  collectionId: string,
  defaultShell: string
): Promise<void> {
  try {
    const result = await window.terminalAPI.selectDirectory()
    if (result.canceled) return
    createTerminal({
      cwd: result.directory || undefined,
      collectionId,
      shell: defaultShell
    })
  } catch (err) {
    console.error('Failed to create terminal:', err)
  }
}

/** Split the focused pane: the new half inherits the focused session's cwd
 *  (tmux-style) and shell, and receives focus. */
export function createTerminalSplit(direction: SplitDirection): string {
  const focusedSessionId = getFocusedSessionId()
  const sessions = useSessionStore.getState().sessions
  const focused = focusedSessionId ? sessions.find((s) => s.id === focusedSessionId) : undefined
  const id = useSessionStore.getState().addSession({
    cwd: focused?.cwd || undefined,
    shell: focused?.shell
  })
  useWorkspaceStore.getState().splitFocused(id, direction)
  return id
}

/** Close a session everywhere: sidebar record (which kills the PTY) plus every
 *  pane-tree leaf across workspaces. */
export function closeSession(id: string): void {
  useSessionStore.getState().removeSession(id)
  useWorkspaceStore.getState().removeSessionEverywhere(id)
}

export function closeAllSessions(): void {
  for (const session of [...useSessionStore.getState().sessions]) {
    closeSession(session.id)
  }
}

/** Sidebar click: activate the session (sidebar highlight + status bar) and
 *  make it visible — switching to its workspace (creating one if needed) and
 *  focusing its pane. */
export function selectSession(id: string): void {
  useSessionStore.getState().setActive(id)
  useWorkspaceStore.getState().ensureVisible(id)
}
