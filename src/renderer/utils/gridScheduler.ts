const TICK_INTERVAL_MS = 180

export interface Tickable {
  tick: () => void
}

// Safety cap on simultaneously-redrawn grids per tick cycle. The scheduler
// ticks every registered grid each cycle; with N visible animated
// ContributionGrids that each cost ~C ms of canvas work, one cycle costs N*C
// ms. gridScheduler.perf.test.tsx measures C and the jank-budget crossover
// N* = 50ms / C. We cap well below N* so the main thread can't be saturated by
// many panes at once — excess grids keep their last frame until a later cycle
// rotates them back in.
export const MAX_ACTIVE_GRIDS = 20

const activeGrids = new Set<Tickable>()
let rafId: number | null = null
let lastTickTime = 0
let cycleIndex = 0

function loop(time: number): void {
  // Skip grid ticks while the tab is hidden — there's nothing to paint and we
  // avoid wasted work (and the rAF still fires in the background on some
  // browsers). Defer the tick timestamp so a single tick fires on return, not
  // a burst catching up on the accumulated gap.
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
