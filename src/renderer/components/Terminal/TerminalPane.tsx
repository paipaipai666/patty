import { useEffect, useRef, useCallback } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import { useSessionStore, type TerminalSession } from '../../store/sessionStore'
import styles from './Terminal.module.css'

interface TerminalPaneProps {
  session: TerminalSession
  isActive: boolean
}

const TERMINAL_THEME = {
  background: '#0f0f12',
  foreground: '#e8e8ec',
  cursor: '#e8e8ec',
  cursorAccent: '#0f0f12',
  selectionBackground: 'rgba(108, 108, 255, 0.3)',
  black: '#1a1a1f',
  red: '#f26b5b',
  green: '#4ec97c',
  yellow: '#f5a623',
  blue: '#4f8ef7',
  magenta: '#a78bfa',
  cyan: '#2dd4bf',
  white: '#c8c8d8',
  brightBlack: '#55556a',
  brightRed: '#f26b5b',
  brightGreen: '#4ec97c',
  brightYellow: '#f5a623',
  brightBlue: '#4f8ef7',
  brightMagenta: '#a78bfa',
  brightCyan: '#2dd4bf',
  brightWhite: '#ffffff'
}

export function TerminalPane({ session, isActive }: TerminalPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const initializedRef = useRef(false)
  const ptyCreatedRef = useRef(false)
  const resizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const initTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const ptyReadyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cleanupDataRef = useRef<(() => void) | null>(null)
  const cleanupExitRef = useRef<(() => void) | null>(null)
  const updatePid = useSessionStore((s) => s.updatePid)

  const fitTerminal = useCallback(
    (skipResize = false) => {
      if (fitAddonRef.current && termRef.current) {
        try {
          fitAddonRef.current.fit()
          if (!skipResize) {
            const term = termRef.current
            window.terminalAPI.resize(session.id, term.cols, term.rows)
          }
        } catch {
          // Ignore fit errors during transitions
        }
      }
    },
    [session.id]
  )

  // Initialize terminal once
  useEffect(() => {
    if (initializedRef.current || !containerRef.current) return
    initializedRef.current = true

    const term = new Terminal({
      fontFamily: '"Cascadia Code", "Cascadia Mono", Consolas, "Courier New", monospace',
      fontSize: 13,
      lineHeight: 1.4,
      letterSpacing: 0,
      fontLigatures: false,
      cursorBlink: true,
      cursorStyle: 'bar',
      allowTransparency: false,
      theme: TERMINAL_THEME,
      scrollback: 10000,
      convertEol: false
    })

    const fitAddon = new FitAddon()
    const webLinksAddon = new WebLinksAddon()

    term.loadAddon(fitAddon)
    term.loadAddon(webLinksAddon)
    term.open(containerRef.current)

    termRef.current = term
    fitAddonRef.current = fitAddon

    // Initial fit — skip PTY resize to avoid double prompt
    initTimerRef.current = setTimeout(() => {
      fitAddon.fit()
      // Create PTY session with fitted dimensions
      const cols = term.cols
      const rows = term.rows
      window.terminalAPI
        .createSession(session.id, session.cwd, session.shell, cols, rows)
        .then((result) => {
          if (result.success && result.pid) {
            updatePid(session.id, result.pid)
          }
        })
      // Delay allowing ResizeObserver-triggered resizes to avoid ConPTY double prompt
      ptyReadyTimerRef.current = setTimeout(() => {
        ptyCreatedRef.current = true
      }, 200)
    }, 50)

    // Forward keyboard input to PTY
    term.onData((data) => {
      window.terminalAPI.write(session.id, data)
    })

    // Receive PTY output
    const cleanupData = window.terminalAPI.onData(session.id, (data) => {
      term.write(data)
    })
    cleanupDataRef.current = cleanupData

    // Handle PTY exit
    const cleanupExit = window.terminalAPI.onExit(session.id, () => {
      ptyCreatedRef.current = false
      term.write('\r\n\x1b[90m[Process exited]\x1b[0m\r\n')
    })
    cleanupExitRef.current = cleanupExit

    return () => {
      if (initTimerRef.current) clearTimeout(initTimerRef.current)
      if (ptyReadyTimerRef.current) clearTimeout(ptyReadyTimerRef.current)
      window.terminalAPI.kill(session.id)
      cleanupDataRef.current?.()
      cleanupExitRef.current?.()
      term.dispose()
      termRef.current = null
      fitAddonRef.current = null
      initializedRef.current = false
    }
  }, [session.id]) // Only re-run if session ID changes (shouldn't happen)

  // Fit when becoming active
  useEffect(() => {
    if (isActive) {
      setTimeout(() => fitTerminal(!ptyCreatedRef.current), 10)
    }
  }, [isActive, fitTerminal])

  // Resize observer (debounced to avoid double prompt from ConPTY)
  useEffect(() => {
    if (!containerRef.current) return

    const observer = new ResizeObserver(() => {
      if (!isActive || !ptyCreatedRef.current) return
      if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current)
      resizeTimerRef.current = setTimeout(() => fitTerminal(), 50)
    })

    observer.observe(containerRef.current)
    return () => {
      observer.disconnect()
      if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current)
    }
  }, [isActive, fitTerminal])

  return (
    <div
      ref={containerRef}
      className={styles.pane}
      style={{ display: isActive ? 'block' : 'none' }}
    />
  )
}
