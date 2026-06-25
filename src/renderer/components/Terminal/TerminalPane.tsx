import { useEffect, useRef, useCallback } from 'react'
import gsap from 'gsap'
import { useGSAP } from '@gsap/react'
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
      theme: getThemeColors(settings.theme, settings.customThemes).terminal,
      scrollback: 10000,
      convertEol: false,
      rescaleOverlappingGlyphs: true
    })

    // Handle copy (Ctrl+Shift+C) and paste (Ctrl+Shift+V)
    term.attachCustomKeyEventHandler((e) => {
      if (e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey) {
        if (e.key === 'C' || e.key === 'c') {
          if (e.type === 'keydown') {
            const selection = term.getSelection()
            if (selection) {
              navigator.clipboard.writeText(selection)
            }
          }
          return false
        }
        if (e.key === 'V' || e.key === 'v') {
          if (e.type === 'keydown') {
            navigator.clipboard.readText().then((text) => {
              if (text) {
                window.terminalAPI.write(session.id, text)
              }
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
    term.open(containerRef.current)

    // --- IME composition window positioning (xterm v5.5) ---
    // xterm.js's updateCompositionElements() repositions the textarea on every
    // render cycle. Without !important CSS, inline left/top directly control the
    // layout position — the IME reads this to place the candidate window.
    //
    // During composition we block style changes on the textarea using
    // Object.defineProperty (synchronous, no race condition). The textarea is
    // already at the cursor position from _syncTextArea (which has an
    // isComposing guard and won't reposition during composition).
    //
    // We do NOT block _compositionView — the IME only reads the textarea
    // position, and the composition view needs to update to show composition text.
    const textarea = containerRef.current?.querySelector(
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

    // Prevent xterm.js built-in paste handler from firing alongside our custom
    // Ctrl+Shift+V handler. Without this, both handlers write the same text
    // to PTY, causing duplicated output (e.g. "echo" → "echoecho").
    // Use capturing phase so we intercept before xterm.js's stopPropagation.
    containerRef.current.addEventListener(
      'paste',
      (e) => {
        e.preventDefault()
        e.stopPropagation()
      },
      true
    )

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

    // Forward keyboard input to PTY and reset attention
    term.onData((data) => {
      window.terminalAPI.write(session.id, data)
      useSessionStore.getState().resetAttention(session.id)
    })

    // Handle PTY exit — restart shell automatically (standard terminal behavior)
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
      if (ptyReadyTimerRef.current) clearTimeout(ptyReadyTimerRef.current)
      if (isComposing) unblockTextareaStyles()
      textarea?.removeEventListener('compositionstart', onCompositionStart)
      textarea?.removeEventListener('compositionend', onCompositionEnd)
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
    term.options.theme = getThemeColors(settings.theme, settings.customThemes).terminal

    // Re-fit after font size change
    setTimeout(() => fitTerminal(), 20)
  }, [settings.fontFamily, settings.fontSize, settings.cursorBlink, settings.cursorStyle, settings.theme, fitTerminal])

  // Terminal entrance animation on mount
  useGSAP(() => {
    if (!containerRef.current) return
    gsap.from(containerRef.current, {
      scaleY: 0,
      opacity: 0,
      transformOrigin: 'top center',
      duration: 0.4,
      ease: 'power3.out',
      delay: 0.05
    })
  }, { scope: containerRef })

  return (
    <div
      ref={containerRef}
      className={styles.pane}
      style={{ display: isActive ? 'block' : 'none', opacity: settings.opacity < 1 ? settings.opacity : undefined }}
    />
  )
}
