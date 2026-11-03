import { useSessionStore } from '../../store/sessionStore'
import { AGENT_STATUS_LABELS, sessionLocation, sessionTool } from '../../utils/sessionPresentation'
import { SHELL_LABELS } from '../../../shared/settingsTypes'
import { TransientPanel } from './TransientPanel'

export function SessionInfo({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const session = useSessionStore(state => state.sessions.find(item => item.id === sessionId))
  const activity = useSessionStore(state => state.agentStates[sessionId])
  return <TransientPanel title="Session details" onClose={onClose}>
    {session ? <dl>
      <dt>Name</dt><dd>{session.title}</dd>
      <dt>Tool</dt><dd>{sessionTool(session)}</dd>
      <dt>Shell</dt><dd>{SHELL_LABELS[session.shell]}</dd>
      <dt>Folder</dt><dd>{session.cwd || 'Not reported'}</dd>
      {session.shell === 'ssh' && <><dt>Connection</dt><dd>{sessionLocation(session)}</dd></>}
      <dt>Status</dt><dd>{activity ? AGENT_STATUS_LABELS[activity.status] : 'Shell session'}</dd>
      <dt>Process</dt><dd>{session.pid > 0 ? `PID ${session.pid}` : 'Not reported'}</dd>
    </dl> : <p role="status">This session is no longer available.</p>}
  </TransientPanel>
}
