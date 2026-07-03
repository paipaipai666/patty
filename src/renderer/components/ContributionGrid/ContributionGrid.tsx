import { useRef, useEffect } from 'react'
import { registerGrid, unregisterGrid } from '../../utils/gridScheduler'
import styles from './ContributionGrid.module.css'

interface Props {
  aiType: 'claude' | 'opencode' | 'codex' | null
}

const ROWS = 5
const GAP = 3.5
const PAD = 6

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
    `rgba(${r},${g},${b},0.30)`,
    `rgba(${r},${g},${b},0.65)`,
    `rgba(${r},${g},${b},1.0)`,
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
        const decay = Math.random() < decayChance ? 1 : 0
        heat[r][c] = Math.max(0, rightHeat - decay)
      } else {
        heat[r][c] = 0
      }
      if (r <= 1 && p < 0.75 && heat[r][c] > 0) {
        if (Math.random() < 0.45) heat[r][c] = Math.max(0, heat[r][c] - 1)
      }
      if (p < 0.35 && heat[r][c] > 0) {
        if (Math.random() < 0.5) heat[r][c] = Math.max(0, heat[r][c] - 1)
      }
    }
  }
}

function renderCells(cells: HTMLDivElement[], heat: number[][], palette: string[]): void {
  let idx = 0
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < heat[r].length; c++) {
      const cell = cells[idx]
      const level = heat[r][c]
      cell.style.backgroundColor = palette[level]
      cell.className = styles.cell + (level >= 3 ? ` ${styles['glow-' + level]}` : '')
      idx++
    }
  }
}

export function ContributionGrid({ aiType }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!aiType || !containerRef.current) return

    const container = containerRef.current
    const parent = container.parentElement
    if (!parent) return

    const parentW = parent.offsetWidth || 240
    const parentH = parent.offsetHeight || 42
    const cellSize = Math.floor((parentH - PAD * 2 - (ROWS - 1) * GAP) / ROWS)
    const usableW = parentW - PAD * 2 - 20
    const COLS = Math.max(16, Math.floor((usableW + GAP) / (cellSize + GAP)))
    const palette = buildPalette(
      aiType === 'claude' ? '--fire-claude' : aiType === 'codex' ? '--fire-codex' : '--fire-opencode'
    )

    container.dataset.type = aiType
    container.style.gridTemplateColumns = `repeat(${COLS}, ${cellSize}px)`
    container.style.gridTemplateRows = `repeat(${ROWS}, ${cellSize}px)`

    const cells: HTMLDivElement[] = []
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const div = document.createElement('div')
        div.className = styles.cell
        cells.push(div)
        container.appendChild(div)
      }
    }

    const heat: number[][] = Array.from({ length: ROWS }, () => new Array(COLS).fill(0))
    let tick = 0

    const grid = {
      tick() {
        tick++
        updateHeat(heat, tick, COLS)
        renderCells(cells, heat, palette)
      }
    }

    registerGrid(grid)

    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          registerGrid(grid)
        } else {
          unregisterGrid(grid)
        }
      }
    })
    observer.observe(container)

    return () => {
      observer.disconnect()
      unregisterGrid(grid)
      container.innerHTML = ''
    }
  }, [aiType])

  if (!aiType) return null

  return <div ref={containerRef} className={styles.grid} />
}
