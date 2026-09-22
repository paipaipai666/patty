import type { SshProfile, SshTarget } from '../../shared/settingsTypes'
import type { SplitDirection } from '../../shared/paneTypes'
import { useSessionStore } from './sessionStore'
import { useWorkspaceStore, getFocusedSessionId } from './workspaceStore'


   

export interface CreateTerminalOptions {
  cwd?: string
  shell?: string
  collectionId?: string | null
  title?: string
  ssh?: SshTarget | null
}

                                                                    
export function createTerminal(opts: CreateTerminalOptions = {}): string {
  const id = useSessionStore.getState().addSession(opts)
  useWorkspaceStore.getState().createWorkspace(id, opts.collectionId ?? null)
  return id
}

                                                  
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


                                        
export function closeSession(id: string): void {
  useSessionStore.getState().removeSession(id)
  useWorkspaceStore.getState().removeSessionEverywhere(id)
}

export function closeAllSessions(): void {
  for (const session of [...useSessionStore.getState().sessions]) {
    closeSession(session.id)
  }
}


                         
export function selectSession(id: string): void {
  useSessionStore.getState().setActive(id)
  useWorkspaceStore.getState().ensureVisible(id)
}
