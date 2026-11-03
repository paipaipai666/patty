import { useId, useLayoutEffect, useRef, useState, useEffect, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { Search20Regular, Dismiss16Regular } from '@fluentui/react-icons'
import type { AppCommand } from '../../commands/applicationCommands'
import { focusActiveTerminal } from '../../commands/useApplicationKeyboard'
import { formatShortcut, isComposingKey, normalizeShortcut } from '../../commands/shortcuts'
import { filterCommands } from './commandSearch'
import styles from './CommandPalette.module.css'

export function CommandPalette({ commands, shortcut, onClose, onExecute }: {
  commands: AppCommand[]
  shortcut: string
  onClose: () => void
  onExecute: (command: AppCommand, origin: Element | null) => void
}) {
  const id = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const origin = useRef(document.activeElement)
  const closing = useRef(false)
  const composing = useRef(false)
  const [query, setQuery] = useState('')
  const [activeId, setActiveId] = useState<string | null>(null)
  const results = filterCommands(commands, query)
  const available = results.filter(command => !command.disabledReason?.())
  const active = available.find(command => command.id === activeId) ?? available[0]
  const optionId = active ? `${id}-option-${results.indexOf(active)}` : undefined

  useLayoutEffect(() => {
    inputRef.current?.focus()
    const contain = (event: FocusEvent) => {
      if (!closing.current && event.target instanceof Node && !dialogRef.current?.contains(event.target)) inputRef.current?.focus()
    }
    document.addEventListener('focusin', contain)
    return () => {
      document.removeEventListener('focusin', contain)
      if (!closing.current) {
        if (origin.current instanceof HTMLElement && origin.current.isConnected) origin.current.focus()
        if (document.activeElement !== origin.current || origin.current === document.body) focusActiveTerminal()
      }
    }
  }, [])

  useEffect(() => { if (optionId) document.getElementById(optionId)?.scrollIntoView?.({ block: 'nearest' }) }, [optionId])

  const cancel = () => { onClose() }
  const execute = (command: AppCommand) => {
    if (closing.current || command.disabledReason?.()) return
    closing.current = true
    onClose()
    onExecute(command, origin.current)
  }
  const keydown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (composing.current || isComposingKey(event.nativeEvent)) return
    if (event.key === 'Escape' || normalizeShortcut(formatShortcut(event.nativeEvent)) === normalizeShortcut(shortcut)) {
      event.preventDefault()
      event.stopPropagation()
      if (!event.repeat) cancel()
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'PageDown' || event.key === 'PageUp') {
      event.preventDefault()
      event.stopPropagation()
      if (available.length === 0) return
      const step = event.key === 'PageDown' ? 5 : event.key === 'PageUp' ? -5 : event.key === 'ArrowDown' ? 1 : -1
      const index = active ? available.indexOf(active) : 0
      setActiveId(available[(index + step % available.length + available.length) % available.length].id)
    } else if (event.key === 'Enter' && event.target === inputRef.current) {
      event.preventDefault()
      event.stopPropagation()
      if (active && !event.repeat) execute(active)
    } else if (event.key === 'Tab' && dialogRef.current) {
      event.preventDefault()
      const close = dialogRef.current.querySelector<HTMLButtonElement>('button')
      if (document.activeElement === inputRef.current) close?.focus()
      else inputRef.current?.focus()
    }
  }

  return createPortal(<div className={styles.overlay} onMouseDown={event => { if (event.target === event.currentTarget) cancel() }}>
    <div ref={dialogRef} className={styles.palette} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} onKeyDown={keydown}>
      <div className={styles.heading}><h2 id={`${id}-title`}>Find sessions and commands</h2><span>{shortcut}</span></div>
      <div className={styles.search}>
        <Search20Regular aria-hidden />
        <input ref={inputRef} role="combobox" aria-label="Search commands" aria-autocomplete="list" aria-expanded="true" aria-controls={`${id}-list`} aria-activedescendant={optionId} aria-describedby={`${id}-help`} autoComplete="off" spellCheck={false}
          placeholder="Search commands, sessions, themes…" value={query}
          onChange={event => { setQuery(event.target.value); setActiveId(null) }}
          onCompositionStart={() => { composing.current = true }} onCompositionEnd={() => { composing.current = false }} />
        <button type="button" className={styles.close} onClick={cancel} aria-label="Close command palette" title="Close (Escape)"><Dismiss16Regular aria-hidden /></button>
      </div>
      <div className={styles.results} role="listbox" id={`${id}-list`} aria-label="Commands">
        {results.map((command, index) => {
          const disabledReason = command.disabledReason?.()
          return <div key={command.id}>
          {(index === 0 || results[index - 1].group !== command.group) && <div className={styles.group} role="presentation">{command.group}</div>}
          <div role="option" id={`${id}-option-${index}`} aria-selected={command.id === active?.id} aria-disabled={Boolean(disabledReason)} className={`${styles.option} ${command.id === active?.id ? styles.selected : ''}`}
            data-command-id={command.id} title={`${command.label}\n${disabledReason ?? command.description}`}
            onPointerMove={() => { if (!disabledReason) setActiveId(command.id) }}
            onMouseDown={event => event.preventDefault()} onClick={() => execute(command)}>
            <span className={styles.copy}><span className={styles.label}>{command.label}</span><span className={styles.description}>{disabledReason ?? command.description}</span></span>
            {command.shortcut && <kbd>{command.shortcut}</kbd>}
          </div>
        </div>})}
        {results.length === 0 && <div className={styles.empty}>No commands match "{query}". Try a session name, folder or action.</div>}
      </div>
      <div className={styles.footer} id={`${id}-help`}>
        <span><kbd>↑</kbd><kbd>↓</kbd> Navigate <kbd>Enter</kbd> Run <kbd>Esc</kbd> Close</span>
        <span role="status" aria-live="polite">{results.length} {results.length === 1 ? 'result' : 'results'}</span>
      </div>
    </div>
  </div>, document.getElementById('root') ?? document.body)
}
