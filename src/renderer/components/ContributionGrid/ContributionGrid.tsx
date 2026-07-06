import { useRef, useEffect } from 'react'
import { registerGrid, unregisterGrid } from '../../utils/gridScheduler'
import styles from './ContributionGrid.module.css'

interface Props {
  aiType: 'claude' | 'opencode' | 'codex' | null
}

const ROWS = 5
const GAP = 2
const PAD = 6
const RADIUS = 1

function parseRgb(color: string): [number, number, number] {
  const m = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
  if (m) return [+m[1], +m[2], +m[3]]
  const hex = color.replace('#', '')
  if (hex.length === 6) {
    return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)]
  }
  return [200, 200, 200]
}

function buildPalette(varName: string): string[] {
  const val = getComputedStyle(document.documentElement).getPropertyValue(varName).trim()
  const [r, g, b] = parseRgb(val || '#cccccc')
  return [
    'transparent',
    `rgba(${r},${g},${b},0.08)`,
    `rgba(${r},${g},${b},0.25)`,
    `rgba(${r},${g},${b},0.60)`,
    `rgba(${r},${g},${b},1.0)`,
  ]
}

function getGlowColors(aiType: string): [string, string] {
  const s = getComputedStyle(document.documentElement)
  const key3 = aiType === 'claude' ? '--fire-glow-claude-3' : aiType === 'codex' ? '--fire-glow-codex-3' : '--fire-glow-opencode-3'
  const key4 = aiType === 'claude' ? '--fire-glow-claude-4' : aiType === 'codex' ? '--fire-glow-codex-4' : '--fire-glow-opencode-4'
  return [
    s.getPropertyValue(key3).trim() || 'rgba(255,255,255,0.25)',
    s.getPropertyValue(key4).trim() || 'rgba(255,255,255,0.5)',
  ]
}

function updateHeat(heat: number[][], tick: number, COLS: number): void {
  const swing = Math.sin(tick * 0.25) * 1.5
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const p = c / COLS
      if (p > 0.92) {
        heat[r][c] = Math.random() < 0.15 ? 3 : 4
        continue
      }
      const rightCol = c + 1
      let rightHeat = rightCol < COLS ? heat[r][rightCol] : 0
      if (r > 0 && Math.random() < 0.35) rightHeat = Math.max(rightHeat, heat[r - 1][c])
      if (r < ROWS - 1 && Math.random() < 0.35) rightHeat = Math.max(rightHeat, heat[r + 1][c])
      if (rightHeat > 0) {
        const distDecay = (1.0 - p) * 0.50
        const decayChance = 0.25 + distDecay + (swing * 0.03)
        heat[r][c] = Math.max(0, rightHeat - (Math.random() < decayChance ? 1 : 0))
      } else {
        heat[r][c] = 0
      }
      if (r <= 1 && p < 0.75 && heat[r][c] > 0 && Math.random() < 0.45) heat[r][c]--
      if (p < 0.35 && heat[r][c] > 0 && Math.random() < 0.5) heat[r][c]--
    }
  }
}

function renderCanvas(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  heat: number[][],
  palette: string[],
  glowColor3: string,
  glowColor4: string,
  cellSize: number,
  COLS: number,
): void {
  ctx.clearRect(0, 0, w, h)

  for (let level = 1; level <= 2; level++) {
    ctx.beginPath()
    let count = 0
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (heat[r][c] === level) {
          ctx.roundRect(PAD + c * (cellSize + GAP), PAD + r * (cellSize + GAP), cellSize, cellSize, RADIUS)
          count++
        }
      }
    }
    if (count > 0) {
      ctx.shadowBlur = 0
      ctx.fillStyle = palette[level]
      ctx.fill()
    }
  }

  for (let level = 3; level <= 4; level++) {
    ctx.beginPath()
    let count = 0
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (heat[r][c] === level) {
          ctx.roundRect(PAD + c * (cellSize + GAP), PAD + r * (cellSize + GAP), cellSize, cellSize, RADIUS)
          count++
        }
      }
    }

    if (count > 0) {
      ctx.fillStyle = palette[level]
      ctx.shadowColor = level === 3 ? glowColor3 : glowColor4
      ctx.shadowBlur = level === 3 ? 4 : 8
      ctx.fill()
    }
  }
}

export function ContributionGrid({ aiType }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!aiType || !containerRef.current || !canvasRef.current) return

    const container = containerRef.current
    const canvas = canvasRef.current
    const parent = container.parentElement
    if (!parent) return

    container.dataset.type = aiType

    const palette = buildPalette(
      aiType === 'claude' ? '--fire-claude' : aiType === 'codex' ? '--fire-codex' : '--fire-opencode'
    )
    const [glowColor3, glowColor4] = getGlowColors(aiType)

    let heat: number[][]
    let currentGrid: { tick(): void } | null = null
    let resizeTimer: ReturnType<typeof setTimeout>

    function init(parentEl: HTMLElement) {
      const dpr = window.devicePixelRatio || 1
      const parentW = parentEl.offsetWidth
      const parentH = parentEl.offsetHeight

      canvas.width = parentW * dpr
      canvas.height = parentH * dpr
      canvas.style.width = parentW + 'px'
      canvas.style.height = parentH + 'px'

      const ctx = canvas.getContext('2d')!
      ctx.scale(dpr, dpr)

      const cellSize = Math.floor((parentH - PAD * 2 - (ROWS - 1) * GAP) / ROWS)
      const usableW = parentW - PAD * 2 - 20
      const COLS = Math.max(16, Math.floor((usableW + GAP) / (cellSize + GAP)))

      heat = Array.from({ length: ROWS }, () => new Array(COLS).fill(0))

      let tick = 0

      if (currentGrid) unregisterGrid(currentGrid)

      currentGrid = {
        tick() {
          tick++
          updateHeat(heat, tick, COLS)
          renderCanvas(ctx, parentW, parentH, heat, palette, glowColor3, glowColor4, cellSize, COLS)
        }
      }
      registerGrid(currentGrid)
    }

    init(parent)

    let firstObserve = true
    const ro = new ResizeObserver(() => {
      if (firstObserve) { firstObserve = false; return }
      clearTimeout(resizeTimer)
      resizeTimer = setTimeout(() => init(parent), 150)
    })
    ro.observe(parent)

    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          if (currentGrid) registerGrid(currentGrid)
        } else {
          if (currentGrid) unregisterGrid(currentGrid)
        }
      }
    })
    observer.observe(container)

    return () => {
      clearTimeout(resizeTimer)
      observer.disconnect()
      ro.disconnect()
      if (currentGrid) unregisterGrid(currentGrid)
    }
  }, [aiType])

  if (!aiType) return null

  return (
    <div ref={containerRef} className={styles.grid}>
      <canvas ref={canvasRef} />
    </div>
  )
}
