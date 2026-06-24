import { useEffect, useRef, useCallback } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import '@xterm/xterm/css/xterm.css'
import { useSessionStore, type TerminalSession } from '../../store/sessionStore'
import { useSettingsStore } from '../../store/settingsStore'
import { getThemeColors } from '../../styles/themes'
import styles from './Terminal.module.css'

interface TerminalPaneProps {
  session: TerminalSession
  isActive: boolean
  onUsed?: (id: string) => void
}

const perfEnabled = (window as any).terminalAPI?.perfEnabled === true

export function TerminalPane({ session, isActive, onUsed }: TerminalPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const webglAddonRef = useRef<WebglAddon | null>(null)
  const ptyCreatedRef = useRef(false)
  const resizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const initTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cleanupDataRef = useRef<(() => void) | null>(null)
  const cleanupExitRef = useRef<(() => void) | null>(null)
  const cleanupImeRef = useRef<(() => void) | null>(null)
  const renderCountRef = useRef(0)
  const updatePid = useSessionStore((s) => s.updatePid)
  const settings = useSettingsStore((s) => s.settings)

  if (perfEnabled) {
    renderCountRef.current++
    if (renderCountRef.current % 10 === 1) {
      console.log(`[perf] TerminalPane[${session.id.slice(0, 8)}] renders: ${renderCountRef.current}`)
    }
  }

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

  // ── Initialize terminal ─────────────────────────────────────────────────

  useEffect(() => {
    if (!containerRef.current) return
    const container = containerRef.current

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
      theme: getThemeColors(settings.theme, settings.customThemes).terminal,
      scrollback: 10000,
      convertEol: false,
      rescaleOverlappingGlyphs: true
    })

    // Copy/paste
    term.attachCustomKeyEventHandler((e) => {
      if (e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey) {
        if (e.key === 'C' || e.key === 'c') {
          if (e.type === 'keydown') {
            const selection = term.getSelection()
            if (selection) navigator.clipboard.writeText(selection)
          }
          return false
        }
        if (e.key === 'V' || e.key === 'v') {
          if (e.type === 'keydown') {
            navigator.clipboard.readText().then((text) => {
              if (text) window.terminalAPI.write(session.id, text)
            })
          }
          return false
        }
      }
      return true
    })

    const fitAddon = new FitAddon()
    const webLinksAddon = new WebLinksAddon()
    const unicode11Addon = new Unicode11Addon()

    term.loadAddon(fitAddon)
    term.loadAddon(webLinksAddon)
    term.open(container)

    // Paste guard
    container.addEventListener('paste', (e) => { e.preventDefault(); e.stopPropagation() }, true)

    // IME composition handling
    const textarea = container.querySelector(
      'textarea.xterm-helper-textarea'
    ) as HTMLElement | null

    let isComposing = false
    let savedLeft = ''
    let savedTop = ''
    let savedScrollIntoView: (() => void) | null = null

    const blockTextareaStyles = () => {
      if (!textarea) return
      const s = textarea.style as any
      savedLeft = s.left
      savedTop = s.top
      Object.defineProperty(s, 'left', {
        set: () => {},
        get: () => savedLeft,
        configurable: true
      })
      Object.defineProperty(s, 'top', {
        set: () => {},
        get: () => savedTop,
        configurable: true
      })
      savedScrollIntoView = textarea.scrollIntoView.bind(textarea)
      textarea.scrollIntoView = () => {}
    }

    const unblockTextareaStyles = () => {
      if (!textarea) return
      const s = textarea.style as any
      delete s.left
      delete s.top
      if (savedScrollIntoView) textarea.scrollIntoView = savedScrollIntoView
    }

    const onCompositionStart = () => {
      isComposing = true
      blockTextareaStyles()
    }
    const onCompositionEnd = () => {
      isComposing = false
      unblockTextareaStyles()
    }

    if (textarea) {
      textarea.addEventListener('compositionstart', onCompositionStart)
      textarea.addEventListener('compositionend', onCompositionEnd)
    }

    // WebGL
    let webglAddon: WebglAddon | null = null
    try {
      webglAddon = new WebglAddon()
      term.loadAddon(webglAddon)
    } catch {
      console.warn('WebGL addon failed to load, falling back to Canvas renderer')
    }

    term.loadAddon(unicode11Addon)
    term.unicode.activeVersion = '11'

    termRef.current = term
    fitAddonRef.current = fitAddon
    webglAddonRef.current = webglAddon

    // Keyboard input → PTY + mark used
    term.onData((data) => {
      window.terminalAPI.write(session.id, data)
      useSessionStore.getState().resetAttention(session.id)
      onUsed?.(session.id)
    })

    // PTY lifecycle
    const startPty = () => {
      cleanupDataRef.current?.()
      cleanupExitRef.current?.()
      window.terminalAPI
        .createSession(session.id, session.cwd, session.shell, term.cols, term.rows)
        .then((result) => {
          if (result.success && result.pid) {
            updatePid(session.id, result.pid)
            ptyCreatedRef.current = true
            cleanupDataRef.current = window.terminalAPI.onData(session.id, (data) => {
              term.write(data)
            })
            cleanupExitRef.current = window.terminalAPI.onExit(session.id, () => {
              ptyCreatedRef.current = false
              term.write('\r\n\x1b[90m[Process exited]\x1b[0m\r\n')
              setTimeout(() => startPty(), 500)
            })
          }
        })
    }

    // Delay PTY creation to allow initial fit
    initTimerRef.current = setTimeout(() => {
      fitAddon.fit()
      startPty()
    }, 50)

    return () => {
      if (initTimerRef.current) clearTimeout(initTimerRef.current)
      if (isComposing) unblockTextareaStyles()
      textarea?.removeEventListener('compositionstart', onCompositionStart)
      textarea?.removeEventListener('compositionend', onCompositionEnd)
      window.terminalAPI.kill(session.id)
      cleanupDataRef.current?.()
      cleanupExitRef.current?.()
      webglAddon?.dispose()
      term.dispose()
      termRef.current = null
      fitAddonRef.current = null
      webglAddonRef.current = null
    }
  }, [session.id]) // Only re-run if session ID changes (shouldn't happen)

  // ── Fit when becoming active ────────────────────────────────────────────

  useEffect(() => {
    if (isActive) {
      setTimeout(() => fitTerminal(!ptyCreatedRef.current), 10)
    }
  }, [isActive, fitTerminal])

  // ── Resize observer ─────────────────────────────────────────────────────

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

  // ── Settings changes ────────────────────────────────────────────────────

  useEffect(() => {
    const term = termRef.current
    if (!term) return

    term.options.fontFamily = `'${settings.fontFamily}', Consolas, 'Courier New', monospace`
    term.options.fontSize = settings.fontSize
    term.options.cursorBlink = settings.cursorBlink
    term.options.cursorStyle = settings.cursorStyle
    term.options.theme = getThemeColors(settings.theme, settings.customThemes).terminal

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
