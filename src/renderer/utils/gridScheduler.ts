const TICK_INTERVAL_MS = 200

export interface Tickable {
  tick: () => void
}

const activeGrids = new Set<Tickable>()
let rafId: number | null = null
let lastTickTime = 0

function loop(time: number): void {
  if (time - lastTickTime >= TICK_INTERVAL_MS) {
    lastTickTime = time
    for (const g of activeGrids) {
      g.tick()
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
