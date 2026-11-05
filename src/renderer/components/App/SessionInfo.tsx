import { useSessionStore } from '../../store/sessionStore'
import { AGENT_STATUS_LABELS, sessionLocation, sessionTool } from '../../utils/sessionPresentation'
import { SHELL_LABELS } from '../../../shared/settingsTypes'
import { TransientPanel } from './TransientPanel'
import { useCommandState } from '../../hooks/useCommandState'
import { formatCommandDuration } from '../../../shared/commandTypes'
import { effectiveActivity } from '../../../shared/programTypes'
import { ProgramDetails } from './ProgramDetails'

export function SessionInfo({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const session = useSessionStore(state => state.sessions.find(item => item.id === sessionId))
  const agent = useSessionStore(state => state.agentStates[sessionId])
  const program = useSessionStore(state => state.programStates[sessionId])
  const activity = effectiveActivity(agent, program)
  const command = useCommandState(session?.id ?? null)
  return <TransientPanel title="Session details" onClose={onClose}>
    {session ? <dl>
      <dt>Name</dt><dd>{session.title}</dd>
      <dt>Tool</dt><dd>{sessionTool(session)}</dd>
      <dt>Shell</dt><dd>{SHELL_LABELS[session.shell]}</dd>
      <dt>Folder</dt><dd>{session.cwd || 'Not reported'}</dd>
      {session.shell === 'ssh' && <><dt>Connection</dt><dd>{sessionLocation(session)}</dd></>}
      <dt>Status</dt><dd>{activity ? AGENT_STATUS_LABELS[activity.status] : 'Shell session'}</dd>
      <ProgramDetails program={program?.program} />
      <dt>Process</dt><dd>{session.pid > 0 ? `PID ${session.pid}` : 'Not reported'}</dd>
      <dt>Command</dt><dd>{!command || command.status === 'unavailable' ? 'Not reported'
        : command.status === 'ready' ? 'Ready for a command'
          : command.status === 'running' ? 'Running'
            : command.status === 'interrupted' ? 'Interrupted' : 'Finished'}</dd>
      {command?.status === 'finished' && <><dt>Exit code</dt><dd>{command.exitCode ?? 'Not reported'}</dd></>}
      {command?.status === 'running' && <><dt>Elapsed</dt><dd>{formatCommandDuration(command.elapsedMs)}</dd></>}
      {command && (command.status === 'finished' || command.status === 'interrupted') && <><dt>Duration</dt><dd>{formatCommandDuration(command.durationMs)}</dd></>}
    </dl> : <p role="status">This session is no longer available.</p>}
  </TransientPanel>
}
