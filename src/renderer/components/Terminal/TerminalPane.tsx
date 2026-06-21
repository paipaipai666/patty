import { useEffect, useRef, useCallback } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import '@xterm/xterm/css/xterm.css'
import { useSessionStore, type TerminalSession } from '../../store/sessionStore'
import { useSettingsStore } from '../../store/settingsStore'
import { XTERM_THEMES } from '../../styles/themes'
import styles from './Terminal.module.css'

interface TerminalPaneProps {
  session: TerminalSession
  isActive: boolean
}

export function TerminalPane({ session, isActive }: TerminalPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const webglAddonRef = useRef<WebglAddon | null>(null)
  const initializedRef = useRef(false)
  const ptyCreatedRef = useRef(false)
  const resizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const initTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const ptyReadyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cleanupDataRef = useRef<(() => void) | null>(null)
  const cleanupExitRef = useRef<(() => void) | null>(null)
  const updatePid = useSessionStore((s) => s.updatePid)
  const settings = useSettingsStore((s) => s.settings)

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
      fontFamily: `'${settings.fontFamily}', Consolas, 'Courier New', monospace`,
      fontSize: settings.fontSize,
      lineHeight: 1.2,
      letterSpacing: 0,
      fontLigatures: true,
      cursorBlink: settings.cursorBlink,
      cursorStyle: settings.cursorStyle,
      allowTransparency: settings.opacity < 1,
      allowProposedApi: true,
      theme: XTERM_THEMES[settings.theme],
      scrollback: 10000,
      convertEol: false,
      rescaleOverlappingGlyphs: true
    })

    const fitAddon = new FitAddon()
    const webLinksAddon = new WebLinksAddon()
    const unicode11Addon = new Unicode11Addon()

    term.loadAddon(fitAddon)
    term.loadAddon(webLinksAddon)
    term.open(containerRef.current)

    try {
      const webglAddon = new WebglAddon()
      term.loadAddon(webglAddon)
      webglAddonRef.current = webglAddon
    } catch {
      console.warn('WebGL addon failed to load, falling back to Canvas renderer')
    }

    term.loadAddon(unicode11Addon)
    term.unicode.activeVersion = '11'

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
      webglAddonRef.current?.dispose()
      webglAddonRef.current = null
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

  // React to settings changes
  useEffect(() => {
    const term = termRef.current
    if (!term) return

    term.options.fontFamily = `'${settings.fontFamily}', Consolas, 'Courier New', monospace`
    term.options.fontSize = settings.fontSize
    term.options.cursorBlink = settings.cursorBlink
    term.options.cursorStyle = settings.cursorStyle
    term.options.theme = XTERM_THEMES[settings.theme]

    // Re-fit after font size change
    setTimeout(() => fitTerminal(), 20)
  }, [settings.fontFamily, settings.fontSize, settings.cursorBlink, settings.cursorStyle, settings.theme, fitTerminal])

  return (
    <div
      ref={containerRef}
      className={styles.pane}
      style={{ display: isActive ? 'block' : 'none', opacity: settings.opacity < 1 ? settings.opacity : undefined }}
    />
  )
}
