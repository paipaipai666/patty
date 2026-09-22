import { useEffect, useRef, useCallback, useState, type RefObject } from 'react'
import { Terminal, type ITerminalOptions } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import { CanvasAddon } from '@xterm/addon-canvas'
import { ImageAddon } from '@xterm/addon-image'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import '@xterm/xterm/css/xterm.css'
import { useSessionStore, type TerminalSession } from '../../store/sessionStore'
import { toast } from '../../store/toastStore'
import { useSettingsStore } from '../../store/settingsStore'
import { getThemeColors } from '../../styles/themes'
import { perfMark, perfMeasure } from '../../../shared/perf'
import styles from './Terminal.module.css'
import { createIIPStreamPatcher } from './iipStreamPatcher'
import { createIipStreamExtractor, findIipSlot, fitIipToCells } from './iipParser'
import type { IipImage } from './iipParser'
import { commitIipPlacement, isStaleIipGeneration, resolveAnchor, type IipOverlayItem } from './iipAnchor'
import { IipOverlay } from './IipOverlay'
import { registerOsc7Handler } from '../../utils/osc7Handler'
import { markTerminalOpen } from '../../utils/shellReadiness'

interface TerminalPaneProps {
  session: TerminalSession

                                                                              
  visible: boolean
  onUsed?: (id: string) => void
}

const perfEnabled = (window as any).terminalAPI?.perfEnabled === true


let webglSupported: boolean | null = null
let webglPermanentlyLost = false

function webglUsable(): boolean {
  if (webglPermanentlyLost) return false
  if (webglSupported === null) {
    try {
      const gl = document.createElement('canvas').getContext('webgl2')
      if (!gl || gl.isContextLost()) {
        webglSupported = false
      } else {

        gl.clearColor(1, 0, 0, 1)
        gl.clear(gl.COLOR_BUFFER_BIT)
        const px = new Uint8Array(4)
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px)
        webglSupported = px[0] > 200
      }
    } catch {
      webglSupported = false
    }
  }
  return webglSupported
}


const ATLAS_PAGE_SOFT_LIMIT = 12
const ATLAS_CHECK_INTERVAL_MS = 2000


interface WebglAtlasInternals {
  _renderer?: { _charAtlas?: { _pages?: unknown[] } }
}

                                                                              
type IntervalHandle = ReturnType<typeof setInterval>

function startAtlasGuard(addonRef: RefObject<WebglAddon | null>): IntervalHandle {
  return setInterval(() => {
    const atlas = (addonRef.current as unknown as WebglAtlasInternals | null)?._renderer?._charAtlas
    const pageCount = atlas?._pages?.length ?? 0
    if (pageCount >= ATLAS_PAGE_SOFT_LIMIT) {
      try {
        addonRef.current?.clearTextureAtlas()
      } catch {

      }
    }
  }, ATLAS_CHECK_INTERVAL_MS)
}

export function TerminalPane({ session, visible, onUsed }: TerminalPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const webglAddonRef = useRef<WebglAddon | null>(null)
  const canvasAddonRef = useRef<CanvasAddon | null>(null)

  const contextLossTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const ptyCreatedRef = useRef(false)

  const atlasClearTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const ptyRetryCountRef = useRef(0)
  const PTY_MAX_RETRIES = 5

  const iipPatcherRef = useRef<((data: string) => string) | null>(null)
  if (!iipPatcherRef.current) {
    iipPatcherRef.current = createIIPStreamPatcher()
  }

  const iipExtractRef = useRef<((data: string) => { out: string; images: IipImage[] }) | null>(null)
  if (!iipExtractRef.current) {
    iipExtractRef.current = createIipStreamExtractor('')
  }
  const [iipItems, setIipItems] = useState<IipOverlayItem[]>([])
  const termForIipRef = useRef<Terminal | null>(null)
  const [cellSize, setCellSize] = useState({ widthPx: 9, heightPx: 18 })
  const [iipScrollTick, setIipScrollTick] = useState(0)


  const iipItemsRef = useRef(iipItems)
  iipItemsRef.current = iipItems
  useEffect(() => {
    if (iipItems.length === 0) return
    let raf = 0
    let last = -1
    let lastBufLen = -1
    const slotMisses: Record<number, number> = {}

    const w = window as unknown as { __iipLiveBaseY?: number; __iipTick?: number }
    const tick = () => {
      const term = termForIipRef.current
      const buf = term?.buffer.active
      const baseY = buf?.baseY ?? 0
      const top = term?.element?.querySelector('.xterm-viewport')?.scrollTop ?? 0
      w.__iipLiveBaseY = baseY
      const key = baseY * 100000 + top
      if (key !== last) {
        last = key
        w.__iipTick = Date.now()
        setIipScrollTick((t) => t + 1)
      }
      if (term && buf) {
        if (buf.length < lastBufLen) {

          lastBufLen = buf.length
          for (const k of Object.keys(slotMisses)) delete slotMisses[Number(k)]
          setIipItems([])
        } else {
          lastBufLen = buf.length
          const items = iipItemsRef.current
          const aliveIds: Record<number, true> = {}
          for (const it of items) aliveIds[it.id] = true
          for (const k of Object.keys(slotMisses)) {
            if (!aliveIds[Number(k)]) delete slotMisses[Number(k)]
          }
          const deadIds: Record<number, true> = {}
          for (const it of items) {
            if (it.fromSlot !== true || it.slotRow < 0) continue
            const line = buf.getLine(it.slotRow)
            const alive =
              !!line && it.slotCol < line.length && line.getCell(it.slotCol)?.getChars() === it.slot
            if (alive) {
              delete slotMisses[it.id]
            } else {
              slotMisses[it.id] = (slotMisses[it.id] ?? 0) + 1
              if (slotMisses[it.id] >= 3) deadIds[it.id] = true
            }
          }
          if (Object.keys(deadIds).length > 0) {
            setIipItems((prev) => prev.filter((x) => !deadIds[x.id]))
          }
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    const vp = termForIipRef.current?.element?.querySelector('.xterm-viewport')
    const onScroll = () => setIipScrollTick((t) => t + 1)
    vp?.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      cancelAnimationFrame(raf)
      vp?.removeEventListener('scroll', onScroll)
    }
  }, [iipItems.length])



     
  const placeIipImage = (term: Terminal, image: IipImage) => {
    const key =
      image.payloadBase64.length +
      ':' +
      image.payloadBase64.slice(0, 32) +
      ':' +
      image.payloadBase64.slice(-32)

    const generation = ptyGenerationRef.current
    const buf = term.buffer.active

    const lines: string[] = []
    for (let i = 0; i < buf.length; i++) {
      const line = buf.getLine(i)
      if (!line) {
        lines.push('')
        continue
      }
      let s = ''
      for (let x = 0; x < line.length; x++) {
        s += line.getCell(x)?.getChars() || ' '
      }
      lines.push(s)
    }
    const hit = findIipSlot(lines, image.slot)
    const cursorAbs = buf.baseY + buf.cursorY

    const el = new Image()
    el.onload = () => {
      if (isStaleIipGeneration(generation, ptyGenerationRef.current)) return
      const core = (term as unknown as { _core?: { _renderService?: { dimensions?: { css?: { cell?: { width: number; height: number } } } } } })._core
      const cellW = core?._renderService?.dimensions?.css?.cell?.width ?? 9
      const cellH = core?._renderService?.dimensions?.css?.cell?.height ?? 18
      setCellSize({ widthPx: cellW, heightPx: cellH })
      const fit = fitIipToCells(
        image,
        { widthPx: el.naturalWidth || 800, heightPx: el.naturalHeight || 600 },
        { widthPx: cellW, heightPx: cellH },
        term.cols
      )

      const anchor = resolveAnchor(hit, lines, cursorAbs, fit.rows)
      ;(window as unknown as { __iipLast?: unknown }).__iipLast = {
        hit,
        cursorAbs,
        fit,
        anchor,
        baseY: term.buffer.active.baseY,
        topY: anchor.topY,
      }
      setIipItems((prevItems) =>
        commitIipPlacement(
          prevItems,
          {
            id: 0,
            key,
            dataUrl: image.dataUrl,
            bufferY: anchor.topY,
            col: anchor.col,
            fromSlot: anchor.fromSlot,
            slot: image.slot,
            slotRow: hit?.row ?? -1,
            slotCol: hit?.col ?? -1,
            rows: fit.rows,
            cols: fit.cols,
          },
          lines
        )
      )
    }
    el.src = image.dataUrl
  }
  const resizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const scaleBridgeRef = useRef<{ w: number; h: number; el: HTMLElement } | null>(null)

  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cleanupDataRef = useRef<(() => void) | null>(null)
  const cleanupExitRef = useRef<(() => void) | null>(null)

  const ptyGenerationRef = useRef(0)
  const firstDataReceivedRef = useRef(false)

  const [hasData, setHasData] = useState(false)
  const renderCountRef = useRef(0)
  const updatePid = useSessionStore((s) => s.updatePid)
  const updateCwd = useSessionStore((s) => s.updateCwd)

  const fontFamily = useSettingsStore((s) => s.settings.fontFamily)
  const fontSize = useSettingsStore((s) => s.settings.fontSize)
  const cursorBlink = useSettingsStore((s) => s.settings.cursorBlink)
  const cursorStyle = useSettingsStore((s) => s.settings.cursorStyle)
  const opacity = useSettingsStore((s) => s.settings.opacity)
  const theme = useSettingsStore((s) => s.settings.theme)
  const customThemes = useSettingsStore((s) => s.settings.customThemes)
  const scrollback = useSettingsStore((s) => s.settings.scrollback)

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

        }
      }
    },
    [session.id]
  )

  const beginScaleBridge = useCallback(() => {
    const root = containerRef.current?.querySelector('.xterm') as HTMLElement | null
    if (!root) return
    const rect = root.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) {
      scaleBridgeRef.current = null
      return
    }
    scaleBridgeRef.current = { w: rect.width, h: rect.height, el: root }
    root.style.transformOrigin = 'top left'

    root.style.transform = `scale(1, 1)`
  }, [])

  const updateScaleBridge = useCallback(() => {
    const base = scaleBridgeRef.current
    const container = containerRef.current
    if (!base || !container) return
    const cw = container.clientWidth
    const ch = container.clientHeight
    if (base.w <= 0 || base.h <= 0 || cw <= 0 || ch <= 0) return
    base.el.style.transform = `scale(${cw / base.w}, ${ch / base.h})`
  }, [])

  const endScaleBridge = useCallback(() => {
    const base = scaleBridgeRef.current
    scaleBridgeRef.current = null
    if (base?.el) {
      base.el.style.transform = ''
      base.el.style.transformOrigin = ''
    }
  }, [])



  useEffect(() => {
    if (!containerRef.current) return
    const container = containerRef.current


    ptyCreatedRef.current = false
    firstDataReceivedRef.current = false
    setHasData(false)
    markTerminalOpen(session.id, session.shell)
    if (perfEnabled) perfMark('terminal:mount')
    cleanupDataRef.current?.()
    cleanupExitRef.current?.()
    cleanupDataRef.current = null
    cleanupExitRef.current = null

    const termOptions: Record<string, unknown> = {
      fontFamily: `'${fontFamily}', Consolas, 'Courier New', monospace`,
      fontSize: fontSize,
      lineHeight: 1.2,
      letterSpacing: 0,
      fontLigatures: true,
      cursorBlink: cursorBlink,
      cursorStyle: cursorStyle,
      allowTransparency: opacity < 1,
      allowProposedApi: true,
      bracketedPasteMode: true,
      theme: getThemeColors(theme, customThemes).terminal,
      scrollback: scrollback,
      convertEol: false,
      rescaleOverlappingGlyphs: true
    }
    if (perfEnabled) perfMark('terminal:xterm-construct')
    const term = new Terminal(termOptions as ITerminalOptions)
    termForIipRef.current = term

    const bumpIip = () => setIipScrollTick((t) => t + 1)
    if (typeof (term as unknown as { onRender?: unknown }).onRender === 'function') {
      ;(term as unknown as { onRender: (cb: () => void) => unknown }).onRender(bumpIip)
    }
    if (typeof term.onScroll === 'function') {
      term.onScroll(bumpIip)
    }
    if (perfEnabled) perfMeasure('terminal:xterm-construct', 'terminal:xterm-construct')


    term.attachCustomKeyEventHandler((e) => {
      if (!e.ctrlKey || e.altKey || e.metaKey) return true

      const isDown = e.type === 'keydown'
      const key = e.key
      const hasSelection = term.hasSelection()

      if (e.shiftKey) {
        if (key === 'C' || key === 'c') {
          if (isDown) {
            const selection = term.getSelection()
            if (selection) navigator.clipboard.writeText(selection)
          }
          return false
        }
        if (key === 'V' || key === 'v') {
          if (isDown) {
            navigator.clipboard.readText().then((text) => {
              if (text) term.paste(text)
            })
          }
          return false
        }
        return true
      }

      if (key === 'C' || key === 'c') {
        if (hasSelection) {
          if (isDown) navigator.clipboard.writeText(term.getSelection())
          return false
        }
        return true
      }

      if (key === 'V' || key === 'v') {
        if (isDown) {
          navigator.clipboard.readText().then((text) => {
            if (text) term.paste(text)
          })
        }
        return false
      }

      return true
    })

    const fitAddon = new FitAddon()
    const webLinksAddon = new WebLinksAddon()
    const unicode11Addon = new Unicode11Addon()

    if (perfEnabled) perfMark('terminal:load-addons')
    term.loadAddon(fitAddon)
    term.loadAddon(webLinksAddon)
    if (perfEnabled) perfMeasure('terminal:load-addons', 'terminal:load-addons')

    if (perfEnabled) perfMark('terminal:term-open')
    term.open(container)
    if (perfEnabled) perfMeasure('terminal:term-open', 'terminal:term-open')


    container.addEventListener('paste', (e) => { e.preventDefault(); e.stopPropagation() }, true)


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


    let webglAddon: WebglAddon | null = null
    let canvasAddon: CanvasAddon | null = null
    if (perfEnabled) perfMark('terminal:webgl-init')
    if (visible) {
      try {
        if (webglUsable()) {
          webglAddon = new WebglAddon()
          term.loadAddon(webglAddon)
        } else {
          canvasAddon = new CanvasAddon()
          term.loadAddon(canvasAddon)
        }
      } catch {
        console.warn('GPU renderer failed to load, using built-in DOM renderer')
      }
    }
    if (perfEnabled) perfMeasure('terminal:webgl-init', 'terminal:webgl-init')

    if (webglAddon) {
      atlasClearTimerRef.current = startAtlasGuard(webglAddonRef)
    }


    if (!(window as any).__imageAddonPatchApplied) {
      const _orig = HTMLCanvasElement.prototype.getContext
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, options?: any) {
        if (type === '2d' && options?.desynchronized) {
          options = { ...options, desynchronized: false }
        }
        return _orig.call(this, type, options)
      } as typeof HTMLCanvasElement.prototype.getContext
      ;(window as any).__imageAddonPatchApplied = true
    }
    if (perfEnabled) perfMark('terminal:image-addon-init')
    try {
      term.loadAddon(new ImageAddon())
    } catch {
      console.warn('Image addon failed to load')
    }

    if (perfEnabled) perfMeasure('terminal:image-addon-init', 'terminal:image-addon-init')

    term.loadAddon(unicode11Addon)
    term.unicode.activeVersion = '11'

    termRef.current = term
    fitAddonRef.current = fitAddon
    webglAddonRef.current = webglAddon
    canvasAddonRef.current = canvasAddon


    const onContextLost = (e: Event) => {
      e.preventDefault()
      if (contextLossTimerRef.current) clearTimeout(contextLossTimerRef.current)
      contextLossTimerRef.current = setTimeout(() => {
        contextLossTimerRef.current = null
        webglPermanentlyLost = true
        try { webglAddonRef.current?.dispose() } catch {                        }
        webglAddonRef.current = null
        try {
          const fallback = new CanvasAddon()
          term.loadAddon(fallback)
          canvasAddonRef.current = fallback
        } catch {

        }
      }, 2000)
    }
    const onContextRestored = () => {
      if (contextLossTimerRef.current) {
        clearTimeout(contextLossTimerRef.current)
        contextLossTimerRef.current = null
      }
      try {
        if (webglAddonRef.current) {
          try { webglAddonRef.current.dispose() } catch {                        }
        }
        const wgl = new WebglAddon()
        term.loadAddon(wgl)
        webglAddonRef.current = wgl
        clearInterval(atlasClearTimerRef.current ?? undefined)
        atlasClearTimerRef.current = startAtlasGuard(webglAddonRef)
      } catch {

      }
    }
    container.addEventListener('webglcontextlost', onContextLost, true)
    container.addEventListener('webglcontextrestored', onContextRestored, true)


    const osc7Disposable = registerOsc7Handler(term, session.id, (id, cwd) => {
      updateCwd(id, cwd)

      const store = useSessionStore.getState()
      if (store.sessions.find((s) => s.id === id)?.aiType) {
        store.setAiType(id, null)
        store.resetAttention(id)
        void window.terminalAPI.hooksClearPane(id)
      }
    })


    term.onData((data) => {
      window.terminalAPI.write(session.id, data)
      useSessionStore.getState().resetAttention(session.id)
      onUsed?.(session.id)
    })


    ptyRetryCountRef.current = 0

    let effectDisposed = false
    const startPty = () => {
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current)
        retryTimerRef.current = null
      }
      cleanupDataRef.current?.()
      cleanupExitRef.current?.()
      if (perfEnabled) perfMark('terminal:create-session-ipc-start')
      const generation = ++ptyGenerationRef.current

      setIipItems([])


      let replayWritten = false
      const liveQueue: string[] = []
      const writeLive = (data: string) => {
        if (!firstDataReceivedRef.current) {
          firstDataReceivedRef.current = true
          setHasData(true)
          if (perfEnabled) perfMeasure('terminal:first-data', 'terminal:create-session-ipc-start')
        }
        const extracted = iipExtractRef.current!(data)
        const placeAll = () => {
          for (const image of extracted.images) placeIipImage(term, image)
        }
        if (extracted.out) term.write(extracted.out, placeAll)
        else placeAll()
      }
      const flushQueue = () => {
        replayWritten = true
        for (const data of liveQueue) writeLive(data)
        liveQueue.length = 0
      }
      const dataSub = window.terminalAPI.onData(session.id, (data) => {
        if (effectDisposed || generation !== ptyGenerationRef.current) return
        if (!replayWritten) {
          liveQueue.push(data)
          return
        }
        writeLive(data)
      })
      const exitSub = window.terminalAPI.onExit(session.id, () => {
        if (effectDisposed || generation !== ptyGenerationRef.current) return
        ptyCreatedRef.current = false
        term.write('\r\n\x1b[90m[Process exited]\x1b[0m\r\n')

        const store = useSessionStore.getState()
        store.setAttention(session.id, null)
        store.setAiType(session.id, null)
        ptyRetryCountRef.current++
        if (ptyRetryCountRef.current < PTY_MAX_RETRIES) {
          retryTimerRef.current = setTimeout(() => startPty(), 500)
        } else {
          term.write('\x1b[90m[Auto-restart limit reached]\x1b[0m\r\n')
        }
      })
      cleanupDataRef.current = dataSub.unsubscribe
      cleanupExitRef.current = exitSub.unsubscribe

      void Promise.all([dataSub.ready, exitSub.ready]).then(() => {
        if (effectDisposed || generation !== ptyGenerationRef.current) return
        window.terminalAPI
          .createSession(session.id, session.cwd, session.shell, term.cols, term.rows, session.ssh ?? null)
          .then((result) => {
            if (effectDisposed || generation !== ptyGenerationRef.current) return
            if (perfEnabled) perfMeasure('terminal:create-session-ipc', 'terminal:create-session-ipc-start')
            if (!result.success || !result.pid) {
              const message = result.error ?? 'unknown error'
              toast(`Failed to start terminal: ${message}`)

              flushQueue()
              term.write(`\r\n\x1b[31m[Connection failed: ${message}]\x1b[0m\r\n`)
              setHasData(true)
              return
            }
            updatePid(session.id, result.pid)
            ptyCreatedRef.current = true
            ptyRetryCountRef.current = 0
            if (result.replay) {

              const extractedReplay = iipExtractRef.current!(result.replay)
              const placeReplay = () => {
                for (const image of extractedReplay.images) placeIipImage(term, image)
              }
              if (extractedReplay.out) term.write(extractedReplay.out, placeReplay)
              else placeReplay()
              setHasData(true)
            }
            flushQueue()
          })
      })
    }


    if (perfEnabled) perfMeasure('terminal:mount-to-init-timer', 'terminal:mount')
    fitAddon.fit()
    startPty()

    return () => {
      effectDisposed = true
      container.removeEventListener('webglcontextlost', onContextLost, true)
      container.removeEventListener('webglcontextrestored', onContextRestored, true)
      osc7Disposable.dispose()
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current)
        retryTimerRef.current = null
      }
      if (atlasClearTimerRef.current) {
        clearInterval(atlasClearTimerRef.current)
        atlasClearTimerRef.current = null
      }
      if (contextLossTimerRef.current) {
        clearTimeout(contextLossTimerRef.current)
        contextLossTimerRef.current = null
      }
      if (isComposing) unblockTextareaStyles()
      textarea?.removeEventListener('compositionstart', onCompositionStart)
      textarea?.removeEventListener('compositionend', onCompositionEnd)
      window.terminalAPI.kill(session.id)
      cleanupDataRef.current?.()
      cleanupExitRef.current?.()
      webglAddonRef.current?.dispose()
      canvasAddonRef.current?.dispose()
      term.dispose()
      termRef.current = null
      fitAddonRef.current = null
      webglAddonRef.current = null
      canvasAddonRef.current = null
    }
  }, [session.id])



  useEffect(() => {
    const term = termRef.current
    if (!term) return

    if (visible) {
      if (!webglAddonRef.current && !canvasAddonRef.current) {
        try {
          if (webglUsable()) {
            const wgl = new WebglAddon()
            term.loadAddon(wgl)
            webglAddonRef.current = wgl
            atlasClearTimerRef.current = startAtlasGuard(webglAddonRef)
          } else {
            const fallback = new CanvasAddon()
            term.loadAddon(fallback)
            canvasAddonRef.current = fallback
          }
        } catch {

        }
      }
    } else {

      if (atlasClearTimerRef.current) {
        clearInterval(atlasClearTimerRef.current)
        atlasClearTimerRef.current = null
      }
      if (webglAddonRef.current) {
        try { webglAddonRef.current.dispose() } catch {                        }
        webglAddonRef.current = null
      }
    }

  }, [visible])



  useEffect(() => {
    if (visible) {

      setTimeout(() => fitTerminal(!ptyCreatedRef.current), 10)
    }
  }, [visible, fitTerminal])



  const sidebarTransitioning = useSessionStore((s) => s.sidebarTransitioning)
  const wasTransitioningRef = useRef(false)

  useEffect(() => {
    if (sidebarTransitioning && !wasTransitioningRef.current) {
      beginScaleBridge()
      updateScaleBridge()
    } else if (!sidebarTransitioning && wasTransitioningRef.current) {
      endScaleBridge()
      fitTerminal()
    }
    wasTransitioningRef.current = sidebarTransitioning
  }, [sidebarTransitioning, fitTerminal, beginScaleBridge, updateScaleBridge, endScaleBridge])



  useEffect(() => {
    if (!containerRef.current) return

    const observer = new ResizeObserver(() => {
      if (!visible) return

      if (useSessionStore.getState().sidebarTransitioning) {
        updateScaleBridge()
        return
      }
      if (!ptyCreatedRef.current) return
      const el = containerRef.current
      if (el && (el.clientWidth === 0 || el.clientHeight === 0)) return
      if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current)
      resizeTimerRef.current = setTimeout(() => fitTerminal(), 50)
    })

    observer.observe(containerRef.current)
    return () => {
      observer.disconnect()
      if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current)
      endScaleBridge()
    }
  }, [visible, fitTerminal, updateScaleBridge, endScaleBridge])




  useEffect(() => {
    const term = termRef.current
    if (!term) return

    term.options.fontFamily = `'${fontFamily}', Consolas, 'Courier New', monospace`
    term.options.fontSize = fontSize
    term.options.cursorBlink = cursorBlink
    term.options.cursorStyle = cursorStyle
    term.options.theme = getThemeColors(theme, customThemes).terminal
  }, [fontFamily, fontSize, cursorBlink, cursorStyle, theme, customThemes])


  useEffect(() => {
    if (!termRef.current) return
    setTimeout(() => fitTerminal(), 20)
  }, [fontFamily, fontSize, fitTerminal])

  return (
    <div
      ref={containerRef}
      className={styles.pane}
      style={{ opacity: opacity < 1 ? opacity : 1 }}
    >
      {!hasData && visible && <div className={styles.bootShimmer} aria-hidden="true" />}
      <IipOverlay
        items={iipItems.map((item) => {
          void iipScrollTick

          const viewportY = termForIipRef.current?.buffer.active.viewportY ?? 0
          return { ...item, row: item.bufferY - viewportY }
        })}
        cell={cellSize}
        originX={0}
        originY={0}
      />
    </div>
  )
}
