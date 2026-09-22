const TICK_INTERVAL_MS = 180

export interface Tickable {
  tick: () => void
}


export const MAX_ACTIVE_GRIDS = 20

const activeGrids = new Set<Tickable>()
let rafId: number | null = null
let lastTickTime = 0
let cycleIndex = 0

function loop(time: number): void {

  if (!document.hidden && time - lastTickTime >= TICK_INTERVAL_MS) {
    lastTickTime = time
    const grids = Array.from(activeGrids)
    if (grids.length <= MAX_ACTIVE_GRIDS) {
      grids.forEach((g) => g.tick())
    } else {
      const start = (cycleIndex * MAX_ACTIVE_GRIDS) % grids.length
      cycleIndex++
      for (let i = 0; i < MAX_ACTIVE_GRIDS; i++) {
        grids[(start + i) % grids.length].tick()
      }
    }
  }
  rafId = requestAnimationFrame(loop)
}

export function registerGrid(grid: Tickable): void {
  const wasEmpty = activeGrids.size === 0
  activeGrids.add(grid)
  if (wasEmpty) {
    lastTickTime = performance.now()
    rafId = requestAnimationFrame(loop)
  }
}

export function unregisterGrid(grid: Tickable): void {
  activeGrids.delete(grid)
  if (activeGrids.size === 0 && rafId !== null) {
    cancelAnimationFrame(rafId)
    rafId = null
  }
}
