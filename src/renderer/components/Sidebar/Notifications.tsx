import { useState } from 'react'
import { useSessionStore } from '../../store/sessionStore'
import { TransientPanel } from '../App/TransientPanel'
import { AGENT_STATUS_LABELS, sessionLocation } from '../../utils/sessionPresentation'
import { noticeSessions, type NoticeView } from './sessionQuery'
import styles from '../App/TransientPanel.module.css'

export function Notifications({ anchor, onClose, onSelect }: { anchor: HTMLElement; onClose: () => void; onSelect: (id: string) => void }) {
  const sessions = useSessionStore(state => state.sessions)
  const agentStates = useSessionStore(state => state.agentStates)
  const [view, setView] = useState<NoticeView>('all')
  const notices = noticeSessions(sessions, agentStates, view)
  return <TransientPanel title="Notifications" anchor={anchor} onClose={onClose}>
    <select aria-label="Notification view" value={view} onChange={event => {
      const value = event.target.value
      if (value === 'all' || value === 'attention' || value === 'complete') setView(value)
    }}><option value="all">New and needs you</option><option value="attention">Needs you</option><option value="complete">Completed</option></select>
    {notices.map(session => <button type="button" key={session.id} className={styles.notice} onClick={() => { onClose(); onSelect(session.id) }}>
      <strong>{session.title}</strong>
      <span>{AGENT_STATUS_LABELS[agentStates[session.id]?.status ?? 'unknown']}{agentStates[session.id]?.unread ? ' · Unread' : ''}</span>
      <span>{sessionLocation(session)}</span>
    </button>)}
    {notices.length === 0 && <p className={styles.empty} role="status">{view === 'complete' ? 'No completed sessions.' : 'Nothing needs your attention.'}</p>}
  </TransientPanel>
}
