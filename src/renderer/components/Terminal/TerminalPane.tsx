import { useEffect, useRef, useCallback } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import { ImageAddon } from '@xterm/addon-image'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import '@xterm/xterm/css/xterm.css'
import { useSessionStore, type TerminalSession } from '../../store/sessionStore'
import { useSettingsStore } from '../../store/settingsStore'
import { getThemeColors } from '../../styles/themes'
import styles from './Terminal.module.css'
import { createIIPStreamPatcher } from './iipStreamPatcher'

interface TerminalPaneProps {
  session: TerminalSession
  /** True when this pane is a visible leaf in the pane tree. In the new
   *  split-tree model only visible leaves mount a TerminalPane at all, so this
   *  is effectively always true for a mounted instance — but it also gates fit
   *  so a pane that briefly has zero size (mid-split) does not fit to 0×0. */
  visible: boolean
  onUsed?: (id: string) => void
}

const perfEnabled = (window as any).terminalAPI?.perfEnabled === true

export function TerminalPane({ session, visible, onUsed }: TerminalPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const webglAddonRef = useRef<WebglAddon | null>(null)
  const ptyCreatedRef = useRef(false)
  // Interval handle for the atlas page-count guard (see webglAddon init block).
  // Cleared on unmount.
  const atlasClearTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const ptyRetryCountRef = useRef(0)
  const PTY_MAX_RETRIES = 5
  // One IIP stream patcher per terminal instance. It holds a small bounded buffer
  // across chunks, so it must live for the lifetime of the terminal (created once,
  // disposed when the terminal unmounts). useRef gives us a stable instance without
  // re-creating on every render.
  const iipPatcherRef = useRef<((data: string) => string) | null>(null)
  if (!iipPatcherRef.current) {
    iipPatcherRef.current = createIIPStreamPatcher()
  }
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

    // Reset per-session refs so a session swap (replaceLeafSession keeps the
    // pane id but changes session.id, re-running this effect) starts clean.
    // Without this, ptyCreatedRef stays true from the previous session and the
    // resize guard / fit logic misbehave; stale onData/onExit callbacks from
    // the previous session could also fire against the new terminal.
    ptyCreatedRef.current = false
    cleanupDataRef.current?.()
    cleanupExitRef.current?.()
    cleanupDataRef.current = null
    cleanupExitRef.current = null

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

    // ── 规避 @xterm/addon-webgl@0.18.0 atlas 合并 Bug ─────────────────────
    // addon-webgl 的 TextureAtlas 在页数 >= max(4, maxAtlasPages)（NVIDIA 通常
    // 16）时合并 4 页→1 页。合并会把 _requestClearModel 置 true 且永不复位，
    // 此后每帧全屏重建；合并瞬态会把 glyph→纹理页映射写错，表现为整窗字符
    // 重影/RGB 分离/上一帧残留。需要长时间高吞吐才填满，故仅长时运行后出现。
    //
    // 规避：高频探测 atlas 页数，到软上限（< 16，留余量）就 clearTextureAtlas，
    // 让页数永远到不了 16 → 合并永不触发。检查只读 _pages.length，极廉价；
    // 只有真到阈值才花成本清（一帧全量重光栅化）。
    //
    // 硬约束：阈值必须 < 16 且留足余量，间隔必须短到“两次检查间页数涨不到
    // (16 - 阈值) 页”，否则第 1 次合并会在两次检查间漏网。只读 internal，
    // 升级后字段改名最多让防护静默失效（退回不防护），不写坏状态。
    if (webglAddon) {
      const ATLAS_PAGE_SOFT_LIMIT = 12 // < 16，留 4 页余量
      const ATLAS_CHECK_INTERVAL_MS = 2000 // 2s：远短于涨 4 页所需时间
      atlasClearTimerRef.current = setInterval(() => {
        const atlas = (webglAddonRef.current as any)?._renderer?._charAtlas
        const pageCount = atlas?._pages?.length ?? 0
        if (pageCount >= ATLAS_PAGE_SOFT_LIMIT) {
          try {
            webglAddonRef.current?.clearTextureAtlas()
          } catch {
            // addon 可能已 dispose，忽略
          }
        }
      }, ATLAS_CHECK_INTERVAL_MS)
    }

    // Sixel / inline images
    // ImageAddon's ImageRenderer creates a 2D canvas with desynchronized: true.
    // In Electron/Chromium, desynchronized 2D canvases fail to alpha-composite
    // over the WebGL text canvas, rendering opaque black instead of transparent.
    // Override getContext globally — safe because only 2D+desynchronized is
    // affected; WebGL contexts use getContext('webgl') which is untouched.
    if (!(window as any).__imageAddonPatchApplied) {
      const _orig = HTMLCanvasElement.prototype.getContext
      HTMLCanvasElement.prototype.getContext = function (type: string, options?: any) {
        if (type === '2d' && options?.desynchronized) {
          options = { ...options, desynchronized: false }
        }
        return _orig.call(this, type, options)
      } as typeof HTMLCanvasElement.prototype.getContext
      ;(window as any).__imageAddonPatchApplied = true
    }
    try {
      term.loadAddon(new ImageAddon())
    } catch {
      console.warn('Image addon failed to load')
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
    ptyRetryCountRef.current = 0
    const startPty = () => {
      cleanupDataRef.current?.()
      cleanupExitRef.current?.()
      window.terminalAPI
        .createSession(session.id, session.cwd, session.shell, term.cols, term.rows)
        .then((result) => {
          if (result.success && result.pid) {
            updatePid(session.id, result.pid)
            ptyCreatedRef.current = true
            ptyRetryCountRef.current = 0
            cleanupDataRef.current = window.terminalAPI.onData(session.id, (data) => {
              term.write(iipPatcherRef.current!(data))
            })
            cleanupExitRef.current = window.terminalAPI.onExit(session.id, () => {
              ptyCreatedRef.current = false
              term.write('\r\n\x1b[90m[Process exited]\x1b[0m\r\n')
              ptyRetryCountRef.current++
              if (ptyRetryCountRef.current < PTY_MAX_RETRIES) {
                setTimeout(() => startPty(), 500)
              } else {
                term.write('\x1b[90m[Auto-restart limit reached]\x1b[0m\r\n')
              }
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
      if (atlasClearTimerRef.current) {
        clearInterval(atlasClearTimerRef.current)
        atlasClearTimerRef.current = null
      }
      if (isComposing) unblockTextareaStyles()
      textarea?.removeEventListener('compositionstart', onCompositionStart)
      textarea?.removeEventListener('compositionend', onCompositionEnd)
      window.terminalAPI.kill(session.id)
      cleanupDataRef.current?.()
      cleanupExitRef.current?.()
      webglAddonRef.current?.dispose()
      term.dispose()
      termRef.current = null
      fitAddonRef.current = null
      webglAddonRef.current = null
    }
  }, [session.id]) // Only re-run if session ID changes (shouldn't happen)

  // ── WebGL context lifecycle: release when hidden ──────────────────────
  // Non-active workspaces use display:none, keeping the xterm instance and
  // PTY alive but wasting a WebGL context. Dispose the WebGL addon when the
  // pane is not visible and re-create it on re-activation so the browser's
  // WebGL context cap (typically ~16) is never hit.

  useEffect(() => {
    const term = termRef.current
    if (!term) return

    if (visible) {
      if (!webglAddonRef.current) {
        try {
          const wgl = new WebglAddon()
          term.loadAddon(wgl)
          webglAddonRef.current = wgl
          atlasClearTimerRef.current = setInterval(() => {
            const atlas = (wgl as any)?._renderer?._charAtlas
            const pageCount = atlas?._pages?.length ?? 0
            if (pageCount >= 12) {
              try { wgl.clearTextureAtlas() } catch { /* disposed in race */ }
            }
          }, 2000)
        } catch {
          // WebGL unavailable — canvas fallback works fine
        }
      }
    } else {
      if (atlasClearTimerRef.current) {
        clearInterval(atlasClearTimerRef.current)
        atlasClearTimerRef.current = null
      }
      if (webglAddonRef.current) {
        try { webglAddonRef.current.dispose() } catch { /* already disposed */ }
        webglAddonRef.current = null
      }
    }
    // Cleanup on unmount: dispose if still alive (handled by main effect below)
  }, [visible])

  // ── Fit when becoming visible / mounted ─────────────────────────────────

  useEffect(() => {
    if (visible) {
      // Slight delay so the flex layout has settled after a split/insert.
      setTimeout(() => fitTerminal(!ptyCreatedRef.current), 10)
    }
  }, [visible, fitTerminal])

  // ── Resize observer ─────────────────────────────────────────────────────

  useEffect(() => {
    if (!containerRef.current) return

    const observer = new ResizeObserver(() => {
      // Only react when the pane has a real size and a live PTY. A hidden or
      // zero-sized pane (mid-split transition) would otherwise fit to 0×0.
      if (!visible || !ptyCreatedRef.current) return
      const el = containerRef.current
      if (el && (el.clientWidth === 0 || el.clientHeight === 0)) return
      if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current)
      resizeTimerRef.current = setTimeout(() => fitTerminal(), 50)
    })

    observer.observe(containerRef.current)
    return () => {
      observer.disconnect()
      if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current)
    }
  }, [visible, fitTerminal])

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
      style={{ opacity: settings.opacity < 1 ? settings.opacity : undefined }}
    />
  )
}
