import { useState } from 'react'
import { useSettingsStore } from '../../store/settingsStore'
import { toast } from '../../store/toastStore'
import type { SshProfile } from '../../../shared/settingsTypes'
import styles from './SettingsModal.module.css'

interface DraftFields {
  name: string
  host: string
  port: string
  user: string
  identityFile: string
}

const EMPTY_DRAFT: DraftFields = { name: '', host: '', port: '', user: '', identityFile: '' }

function fieldsFromProfile(p: SshProfile): DraftFields {
  return {
    name: p.name,
    host: p.host,
    port: p.port?.toString() ?? '',
    user: p.user ?? '',
    identityFile: p.identityFile ?? ''
  }
}

/** Normalize raw form fields into a profile payload. Port 22/blank is the ssh
 *  default and stored as undefined; blank optional strings become undefined;
 *  a blank name derives from user@host so the list stays readable. */
function normalizeDraft(fields: DraftFields): Omit<SshProfile, 'id'> {
  const host = fields.host.trim()
  const user = fields.user.trim() || undefined
  const portNum = parseInt(fields.port, 10)
  const port = Number.isFinite(portNum) && portNum !== 22 ? portNum : undefined
  const name = fields.name.trim() || (user ? `${user}@${host}` : host)
  return {
    name,
    host,
    port,
    user,
    identityFile: fields.identityFile.trim() || undefined
  }
}

export function SshSettingsPanel() {
  const profiles = useSettingsStore((s) => s.settings.sshProfiles)
  const updateSetting = useSettingsStore((s) => s.updateSetting)
  // editingId: profile id being edited, 'new' for the add form, null for list view.
  const [editingId, setEditingId] = useState<string | 'new' | null>(null)
  const [draft, setDraft] = useState<DraftFields>(EMPTY_DRAFT)
  const [importing, setImporting] = useState(false)

  const startAdd = () => {
    setDraft(EMPTY_DRAFT)
    setEditingId('new')
  }

  const startEdit = (p: SshProfile) => {
    setDraft(fieldsFromProfile(p))
    setEditingId(p.id)
  }

  const cancelEdit = () => {
    setEditingId(null)
    setDraft(EMPTY_DRAFT)
  }

  const portValid = draft.port.trim() === '' || (/^\d+$/.test(draft.port.trim()) && +draft.port >= 1 && +draft.port <= 65535)
  const canSave = draft.host.trim() !== '' && portValid

  const handleSave = () => {
    if (!canSave) return
    const payload = normalizeDraft(draft)
    if (editingId === 'new') {
      void updateSetting('sshProfiles', [...profiles, { ...payload, id: crypto.randomUUID() }])
    } else {
      void updateSetting(
        'sshProfiles',
        profiles.map((p) => (p.id === editingId ? { ...payload, id: p.id } : p))
      )
    }
    cancelEdit()
  }

  const handleDelete = (id: string) => {
    void updateSetting('sshProfiles', profiles.filter((p) => p.id !== id))
    if (editingId === id) cancelEdit()
  }

  const handleImport = async () => {
    setImporting(true)
    try {
      const result = await window.terminalAPI.sshConfigImport()
      const drafts = result.profiles ?? []
      const added = drafts
        .filter(
          (d) =>
            !profiles.some(
              (p) => p.name === d.name || (p.host === d.host && (p.user ?? '') === (d.user ?? ''))
            )
        )
        .map((d) => ({ ...d, id: crypto.randomUUID() }))
      if (added.length > 0) {
        void updateSetting('sshProfiles', [...profiles, ...added])
        toast(`Imported ${added.length} profile(s)`)
      } else {
        toast('No new hosts found in ~/.ssh/config')
      }
    } catch (err) {
      toast(`SSH config import failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className={styles.section}>
      <div className={styles.sectionTitle}>SSH Profiles</div>

      {profiles.length > 0 && (
        <div className={styles.themeList}>
          {profiles.map((p) => (
            <div key={p.id} className={styles.themeItem}>
              <span className={styles.themeItemName}>
                {p.name}
                <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>
                  {p.user ? `${p.user}@` : ''}
                  {p.host}:{p.port ?? 22}
                </span>
              </span>
              <span className={styles.themeItemActions}>
                <button type="button" className={styles.themeActionBtn} onClick={() => startEdit(p)}>
                  Edit
                </button>
                <button type="button" className={styles.themeActionBtn} onClick={() => handleDelete(p.id)}>
                  Delete
                </button>
              </span>
            </div>
          ))}
        </div>
      )}

      {editingId === null ? (
        <div className={styles.themeListActions}>
          <button type="button" className={styles.themeBtn} onClick={startAdd}>
            Add Profile
          </button>
          <button type="button" className={styles.themeBtn} onClick={() => void handleImport()} disabled={importing}>
            {importing ? 'Importing…' : 'Import from ~/.ssh/config'}
          </button>
        </div>
      ) : (
        <div className={styles.themeDetail}>
          <div className={styles.settingRow}>
            <span className={styles.settingLabel}>Name</span>
            <input
              className={styles.fontPickerInput}
              style={{ minWidth: 220 }}
              value={draft.name}
              placeholder="Optional — defaults to user@host"
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </div>
          <div className={styles.settingRow}>
            <span className={styles.settingLabel}>Host *</span>
            <input
              className={styles.fontPickerInput}
              style={{ minWidth: 220 }}
              value={draft.host}
              placeholder="example.com or 192.168.1.10"
              onChange={(e) => setDraft({ ...draft, host: e.target.value })}
            />
          </div>
          <div className={styles.settingRow}>
            <span className={styles.settingLabel}>Port</span>
            <input
              className={styles.fontPickerInput}
              style={{ minWidth: 220 }}
              value={draft.port}
              placeholder="22"
              inputMode="numeric"
              onChange={(e) => setDraft({ ...draft, port: e.target.value })}
            />
          </div>
          {!portValid && <div className={styles.jsonError}>Port must be a number between 1 and 65535</div>}
          <div className={styles.settingRow}>
            <span className={styles.settingLabel}>User</span>
            <input
              className={styles.fontPickerInput}
              style={{ minWidth: 220 }}
              value={draft.user}
              placeholder="Optional — ssh uses your local username"
              onChange={(e) => setDraft({ ...draft, user: e.target.value })}
            />
          </div>
          <div className={styles.settingRow}>
            <span className={styles.settingLabel}>Identity File</span>
            <input
              className={styles.fontPickerInput}
              style={{ minWidth: 220 }}
              value={draft.identityFile}
              placeholder="~/.ssh/id_ed25519"
              onChange={(e) => setDraft({ ...draft, identityFile: e.target.value })}
            />
          </div>
          <div className={styles.themeListActions}>
            <button type="button" className={styles.themeBtn} onClick={handleSave} disabled={!canSave}>
              Save
            </button>
            <button type="button" className={styles.themeBtn} onClick={cancelEdit}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
