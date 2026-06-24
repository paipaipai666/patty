import { useRef, useEffect } from 'react'
import styles from './ContributionGrid.module.css'

interface Props {
  aiType: 'claude' | 'opencode' | null
}

const ROWS = 5
const GAP = 3.5
const PAD = 6

const PALETTES: Record<string, string[]> = {
  claude: [
    'transparent',
    'rgba(204,120,92,0.08)',
    'rgba(204,120,92,0.30)',
    'rgba(204,120,92,0.65)',
    'rgba(204,120,92,1.0)',
  ],
  opencode: [
    'transparent',
    'rgba(255,255,255,0.06)',
    'rgba(255,255,255,0.25)',
    'rgba(255,255,255,0.55)',
    'rgba(255,255,255,0.95)',
  ],
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
    const palette = PALETTES[aiType] || PALETTES.opencode

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
    let intervalId: ReturnType<typeof setInterval> | null = null

    function update() {
      tick++
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

    function render() {
      let idx = 0
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const cell = cells[idx]
          const level = heat[r][c]
          cell.style.backgroundColor = palette[level]
          cell.className = styles.cell + (level >= 3 ? ` ${styles['glow-' + level]}` : '')
          idx++
        }
      }
    }

    update()
    render()
    intervalId = setInterval(() => { update(); render() }, 200)

    return () => {
      if (intervalId) clearInterval(intervalId)
      container.innerHTML = ''
    }
  }, [aiType])

  if (!aiType) return null

  return <div ref={containerRef} className={styles.grid} />
}