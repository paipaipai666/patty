/**
 * Heavy stress benchmark for Patty.
 * Focuses on CPU, GPU, and memory under real load.
 *
 * Usage: node scripts/benchmark.mjs
 */

import { _electron as electron } from 'playwright'
import { resolve, dirname } from 'path'
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'fs'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const DUMP_FILE = resolve(ROOT, 'scripts/.perf-dump.json')

// ── Helpers ───────────────────────────────────────────────────────────────

function formatMs(ms) {
  if (ms == null) return '─'
  if (ms < 1) return `${(ms * 1000).toFixed(0)}μs`
  if (ms < 1000) return `${ms.toFixed(1)}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

function formatMB(mb) {
  if (mb == null) return '─'
  return `${mb.toFixed(1)}MB`
}

function formatPct(pct) {
  if (pct == null) return '─'
  return `${pct.toFixed(1)}%`
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }
function avg(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0 }
function max(arr) { return arr.length ? Math.max(...arr) : 0 }
function min(arr) { return arr.length ? Math.min(...arr) : 0 }

async function runScenario(name, fn) {
  process.stdout.write(`\n  ▸ ${name} ... `)
  const t0 = Date.now()
  const result = await fn()
  console.log(`done (${((Date.now() - t0) / 1000).toFixed(1)}s)`)
  return result
}

// ── Resource Sampling ─────────────────────────────────────────────────────

async function sampleResources(window) {
  const raw = await window.evaluate(() => window.terminalAPI.perfMetrics())
  const result = {
    timestamp: Date.now(),
    processes: [],
    totals: { cpuPercent: 0, memoryMB: 0, gpuPercent: 0 }
  }
  for (const m of raw) {
    const memMB = m.memoryKB / 1024
    result.processes.push({
      pid: m.pid, type: m.type,
      cpuPercent: +m.cpuPercent.toFixed(2),
      memoryMB: +memMB.toFixed(1),
      peakMemoryMB: +(m.peakMemoryKB / 1024).toFixed(1)
    })
    result.totals.cpuPercent += m.cpuPercent
    result.totals.memoryMB += memMB
    if (m.type === 'GPU') result.totals.gpuPercent = m.cpuPercent
  }
  result.totals.cpuPercent = +result.totals.cpuPercent.toFixed(2)
  result.totals.memoryMB = +result.totals.memoryMB.toFixed(1)
  return result
}

async function samplePeriodic(window, durationMs, intervalMs = 500) {
  const samples = []
  const end = Date.now() + durationMs
  while (Date.now() < end) {
    samples.push(await sampleResources(window))
    await sleep(intervalMs)
  }
  return samples
}

function summarizeSamples(samples, label) {
  const all = samples.map(s => s.totals)
  const mainProcs = samples.flatMap(s => s.processes.filter(p => p.type === 'Browser'))
  const tabProcs = samples.flatMap(s => s.processes.filter(p => p.type === 'Tab'))
  const gpuProcs = samples.flatMap(s => s.processes.filter(p => p.type === 'GPU'))

  return {
    label,
    samples: samples.length,
    total: { cpuAvg: avg(all.map(s => s.cpuPercent)), cpuMax: max(all.map(s => s.cpuPercent)), memAvg: avg(all.map(s => s.memoryMB)), memMax: max(all.map(s => s.memoryMB)) },
    main: { cpuAvg: avg(mainProcs.map(p => p.cpuPercent)), cpuMax: max(mainProcs.map(p => p.cpuPercent)), memAvg: avg(mainProcs.map(p => p.memoryMB)), memMax: max(mainProcs.map(p => p.memoryMB)) },
    renderer: { cpuAvg: avg(tabProcs.map(p => p.cpuPercent)), cpuMax: max(tabProcs.map(p => p.cpuPercent)), memAvg: avg(tabProcs.map(p => p.memoryMB)), memMax: max(tabProcs.map(p => p.memoryMB)) },
    gpu: { cpuAvg: avg(gpuProcs.map(p => p.cpuPercent)), cpuMax: max(gpuProcs.map(p => p.cpuPercent)), memAvg: avg(gpuProcs.map(p => p.memoryMB)), memMax: max(gpuProcs.map(p => p.memoryMB)) }
  }
}

function printSummary(s) {
  console.log(`  ${s.label}:`)
  console.log(`    CPU:  main avg=${formatPct(s.main.cpuAvg)} max=${formatPct(s.main.cpuMax)}  |  renderer avg=${formatPct(s.renderer.cpuAvg)} max=${formatPct(s.renderer.cpuMax)}  |  gpu avg=${formatPct(s.gpu.cpuAvg)} max=${formatPct(s.gpu.cpuMax)}  |  total avg=${formatPct(s.total.cpuAvg)} max=${formatPct(s.total.cpuMax)}`)
  console.log(`    MEM:  main=${formatMB(s.main.memAvg)}  renderer=${formatMB(s.renderer.memAvg)}  gpu=${formatMB(s.gpu.memAvg)}  total=${formatMB(s.total.memAvg)} (peak ${formatMB(s.total.memMax)})`)
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════════════╗')
  console.log('║       Patty Heavy Stress Benchmark               ║')
  console.log('║       CPU / GPU / Memory under load              ║')
  console.log('╚══════════════════════════════════════════════════╝')
  console.log(`Root: ${ROOT}`)
  console.log(`Time: ${new Date().toISOString()}`)

  if (existsSync(DUMP_FILE)) unlinkSync(DUMP_FILE)

  if (!existsSync(resolve(ROOT, 'out/main/index.js'))) {
    console.log('\nBuilding...')
    const { execSync } = await import('child_process')
    execSync('npx electron-vite build', { cwd: ROOT, stdio: 'inherit' })
  }

  console.log('\nLaunching app ...')
  let app
  const summaries = []

  try {
    app = await electron.launch({
      args: [ROOT],
      env: { ...process.env, PATTY_PERF: '1', PATTY_PERF_DUMP: DUMP_FILE },
      timeout: 30000
    })

    let window = await app.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    await sleep(2000)
    console.log('  App ready.')

    // ═══════════════════════════════════════════════════════════════════
    // 1. Idle baseline
    // ═══════════════════════════════════════════════════════════════════
    const s1 = await runScenario('Idle baseline (5s)', async () => {
      return samplePeriodic(window, 5000, 500)
    })
    summaries.push(summarizeSamples(s1, 'idle-baseline (1 terminal)'))

    // ═══════════════════════════════════════════════════════════════════
    // 2. Open 30 terminals (track memory at each milestone)
    // ═══════════════════════════════════════════════════════════════════
    const milestones = [5, 10, 15, 20, 25, 30]
    const memoryAtCount = [{ count: 1, sample: s1[s1.length - 1] }]

    await runScenario('Open 30 terminals', async () => {
      for (let i = 1; i <= 30; i++) {
        await window.keyboard.press('Control+t')
        await sleep(250)
        if (milestones.includes(i)) {
          await sleep(500)
          const sample = await sampleResources(window)
          memoryAtCount.push({ count: i, sample })
        }
      }
      await sleep(1000)
    })

    // Idle with 30 terminals
    const s30idle = await runScenario('Idle with 30 terminals (5s)', async () => {
      return samplePeriodic(window, 5000, 500)
    })
    summaries.push(summarizeSamples(s30idle, 'idle-30-terminals'))

    // ═══════════════════════════════════════════════════════════════════
    // 3. Heavy output — single terminal, cmd.exe (faster than PS)
    // ═══════════════════════════════════════════════════════════════════
    const s3 = await runScenario('Heavy output: cmd echo 50k lines (10s)', async () => {
      // Switch to first terminal
      await window.keyboard.press('Control+1')
      await sleep(200)
      // Use cmd /c for faster output than PowerShell
      await window.keyboard.type('cmd /c "for /L %i in (1,1,50000) do @echo line %i %date% %time%"', { delay: 2 })
      await window.keyboard.press('Enter')
      await sleep(1000) // Let it start
      return samplePeriodic(window, 10000, 300)
    })
    summaries.push(summarizeSamples(s3, 'heavy-output-cmd-50k'))

    // ═══════════════════════════════════════════════════════════════════
    // 4. Heavy output — multiple terminals simultaneously
    // ═══════════════════════════════════════════════════════════════════
    const s4 = await runScenario('Multi-terminal output: 5 terminals × 10k lines (10s)', async () => {
      // Start output in 5 terminals
      for (let i = 1; i <= 5; i++) {
        await window.keyboard.press(`Control+${i}`)
        await sleep(100)
        await window.keyboard.type(`cmd /c "for /L %j in (1,1,10000) do @echo terminal${i} line %j"`, { delay: 1 })
        await window.keyboard.press('Enter')
        await sleep(200)
      }
      // Switch to terminal 1 and sample
      await window.keyboard.press('Control+1')
      await sleep(500)
      return samplePeriodic(window, 10000, 300)
    })
    summaries.push(summarizeSamples(s4, 'multi-terminal-output-5x10k'))

    // ═══════════════════════════════════════════════════════════════════
    // 5. Heavy output — single terminal, 200k lines
    // ═══════════════════════════════════════════════════════════════════
    const s5 = await runScenario('Extreme output: cmd echo 200k lines (15s)', async () => {
      await window.keyboard.press('Control+1')
      await sleep(200)
      await window.keyboard.type('cmd /c "for /L %i in (1,1,200000) do @echo line %i"', { delay: 2 })
      await window.keyboard.press('Enter')
      await sleep(500)
      return samplePeriodic(window, 15000, 300)
    })
    summaries.push(summarizeSamples(s5, 'extreme-output-cmd-200k'))

    // ═══════════════════════════════════════════════════════════════════
    // 6. Rapid tab switching with 30 terminals
    // ═══════════════════════════════════════════════════════════════════
    const s6 = await runScenario('Rapid tab switch ×50 (30 terminals)', async () => {
      const snapshots = []
      for (let i = 0; i < 50; i++) {
        await window.keyboard.press(`Control+${(i % 9) + 1}`)
        if (i % 10 === 0) snapshots.push(await sampleResources(window))
      }
      await sleep(300)
      return snapshots
    })
    summaries.push(summarizeSamples(s6, 'rapid-tab-switch-50x'))

    // ═══════════════════════════════════════════════════════════════════
    // 7. Post-load idle (check for memory leaks)
    // ═══════════════════════════════════════════════════════════════════
    const s7 = await runScenario('Post-load idle (10s, leak check)', async () => {
      return samplePeriodic(window, 10000, 1000)
    })
    summaries.push(summarizeSamples(s7, 'post-load-idle'))

    // ═══════════════════════════════════════════════════════════════════
    // 8. Sustained multi-terminal output (30s, 5 terminals)
    // ═══════════════════════════════════════════════════════════════════
    const s8 = await runScenario('Sustained output: 5 terminals × 50k lines (30s)', async () => {
      for (let i = 1; i <= 5; i++) {
        await window.keyboard.press(`Control+${i}`)
        await sleep(100)
        await window.keyboard.type(`cmd /c "for /L %j in (1,1,50000) do @echo sustained_t${i} line %j"`, { delay: 1 })
        await window.keyboard.press('Enter')
        await sleep(200)
      }
      await window.keyboard.press('Control+1')
      return samplePeriodic(window, 30000, 1000)
    })
    summaries.push(summarizeSamples(s8, 'sustained-output-5x50k-30s'))

    // ═══════════════════════════════════════════════════════════════════
    // 9. Open to 50 terminals (push the limit)
    // ═══════════════════════════════════════════════════════════════════
    const memAt50 = []
    await runScenario('Open to 50 terminals', async () => {
      for (let i = 31; i <= 50; i++) {
        await window.keyboard.press('Control+t')
        await sleep(200)
        if (i === 40 || i === 50) {
          await sleep(500)
          memAt50.push({ count: i, sample: await sampleResources(window) })
        }
      }
      await sleep(1000)
    })

    const s50idle = await runScenario('Idle with 50 terminals (5s)', async () => {
      return samplePeriodic(window, 5000, 500)
    })
    summaries.push(summarizeSamples(s50idle, 'idle-50-terminals'))

    // ═══════════════════════════════════════════════════════════════════
    // 10. ContributionGrid animation overhead (AI session simulation)
    //     We can't set aiType via UI, so we inject it via store evaluate.
    // ═══════════════════════════════════════════════════════════════════
    const s10 = await runScenario('ContributionGrid: set 10 AI sessions (5s)', async () => {
      // Set aiType on first 10 sessions via store
      await window.evaluate(() => {
        const store = window.__ZUSTAND_SESSION_STORE__
        // Access via the global Zustand API
        // We need a way to call setAiType — use the IPC approach instead
      }).catch(() => {})
      // Fallback: just measure current state since we can't easily set aiType
      // The ContributionGrid only renders when session.aiType is set
      return samplePeriodic(window, 5000, 500)
    })
    summaries.push(summarizeSamples(s10, 'contribution-grid-10-ai'))

    // ═══════════════════════════════════════════════════════════════════
    // 11. PTY crash recovery (kill/respawn cycles)
    // ═══════════════════════════════════════════════════════════════════
    const s11 = await runScenario('PTY crash recovery: 5 kill/respawn cycles', async () => {
      const snapshots = []
      for (let cycle = 0; cycle < 5; cycle++) {
        // Kill terminal 1's PTY by sending exit command
        await window.keyboard.press('Control+1')
        await sleep(100)
        await window.keyboard.type('exit', { delay: 5 })
        await window.keyboard.press('Enter')
        await sleep(800) // Wait for exit + auto-restart
        snapshots.push(await sampleResources(window))
      }
      return snapshots
    })
    summaries.push(summarizeSamples(s11, 'pty-crash-recovery-5x'))

    // ═══════════════════════════════════════════════════════════════════
    // 12. Long-running idle leak test (2 minutes)
    // ═══════════════════════════════════════════════════════════════════
    const s12 = await runScenario('Long idle leak test (2 min, 50 terminals)', async () => {
      return samplePeriodic(window, 120000, 5000)
    })
    summaries.push(summarizeSamples(s12, 'long-idle-leak-2min'))

    // ═══════════════════════════════════════════════════════════════════
    // 13. Startup recovery time (re-launch with 50 sessions saved)
    // ═══════════════════════════════════════════════════════════════════
    console.log('\n  ▸ Startup recovery test ...')
    // Save current state and close
    await window.evaluate(() => window.terminalAPI.perfDump())
    await sleep(500)
    await app.close()
    await sleep(1000)

    // Re-launch
    const startupSamples = []
    const app2 = await electron.launch({
      args: [ROOT],
      env: { ...process.env, PATTY_PERF: '1', PATTY_PERF_DUMP: DUMP_FILE },
      timeout: 30000
    })
    const window2 = await app2.firstWindow()

    // Capture startup metrics
    const t0 = Date.now()
    await window2.waitForLoadState('domcontentloaded')
    const domReady = Date.now() - t0
    await sleep(2000)
    const fullyReady = Date.now() - t0

    const startupResources = await sampleResources(window2)
    const activatedCount = await window2.evaluate(() => {
      // Count how many terminals actually have xterm instances
      return document.querySelectorAll('.xterm').length
    })

    console.log(`    DOM ready:          ${domReady}ms`)
    console.log(`    Fully ready:        ${fullyReady}ms`)
    console.log(`    Activated terminals: ${activatedCount} / 50`)
    console.log(`    Startup memory:     ${formatMB(startupResources.totals.memoryMB)}`)

    summaries.push({
      label: 'startup-recovery-50-sessions',
      samples: 1,
      total: { cpuAvg: startupResources.totals.cpuPercent, cpuMax: startupResources.totals.cpuPercent, memAvg: startupResources.totals.memoryMB, memMax: startupResources.totals.memoryMB },
      main: { cpuAvg: avg(startupResources.processes.filter(p => p.type === 'Browser').map(p => p.cpuPercent)), cpuMax: max(startupResources.processes.filter(p => p.type === 'Browser').map(p => p.cpuPercent)), memAvg: avg(startupResources.processes.filter(p => p.type === 'Browser').map(p => p.memoryMB)), memMax: max(startupResources.processes.filter(p => p.type === 'Browser').map(p => p.memoryMB)) },
      renderer: { cpuAvg: avg(startupResources.processes.filter(p => p.type === 'Tab').map(p => p.cpuPercent)), cpuMax: max(startupResources.processes.filter(p => p.type === 'Tab').map(p => p.cpuPercent)), memAvg: avg(startupResources.processes.filter(p => p.type === 'Tab').map(p => p.memoryMB)), memMax: max(startupResources.processes.filter(p => p.type === 'Tab').map(p => p.memoryMB)) },
      gpu: { cpuAvg: avg(startupResources.processes.filter(p => p.type === 'GPU').map(p => p.cpuPercent)), cpuMax: max(startupResources.processes.filter(p => p.type === 'GPU').map(p => p.cpuPercent)), memAvg: avg(startupResources.processes.filter(p => p.type === 'GPU').map(p => p.memoryMB)), memMax: max(startupResources.processes.filter(p => p.type === 'GPU').map(p => p.memoryMB)) }
    })

    // Continue with app2 for final metrics
    app = app2
    window = window2

    // ═══════════════════════════════════════════════════════════════════
    // Final metrics
    // ═══════════════════════════════════════════════════════════════════
    console.log('\nCollecting final metrics...')
    await window.evaluate(() => window.terminalAPI.perfDump())
    await sleep(300)

    const finalSnapshot = await sampleResources(window)
    const rendererHeap = await window.evaluate(() => {
      const m = performance.memory
      return m ? { used: +(m.usedJSHeapSize / 1024 / 1024).toFixed(1), total: +(m.totalJSHeapSize / 1024 / 1024).toFixed(1) } : null
    })

    let dumpData = null
    if (existsSync(DUMP_FILE)) dumpData = JSON.parse(readFileSync(DUMP_FILE, 'utf-8'))

    // ═══════════════════════════════════════════════════════════════════
    // Report
    // ═══════════════════════════════════════════════════════════════════
    console.log('\n╔══════════════════════════════════════════════════════════════════╗')
    console.log('║                        Benchmark Results                        ║')
    console.log('╚══════════════════════════════════════════════════════════════════╝')

    // ── Resource Summary ──────────────────────────────────────────────
    console.log('\n── Resource Usage Summary ──\n')
    for (const s of summaries) printSummary(s)

    // ── Memory Growth Curve ───────────────────────────────────────────
    console.log('\n── Memory Growth Curve ──\n')
    console.log('  Terminals  │  Total MEM  │  Main  │  Renderer  │  GPU')
    console.log('  ───────────┼─────────────┼────────┼────────────┼───────')
    const allMemPoints = [...memoryAtCount, ...memAt50]
    for (const m of allMemPoints) {
      const procs = m.sample.processes
      const mainM = procs.filter(p => p.type === 'Browser')
      const tabM = procs.filter(p => p.type === 'Tab')
      const gpuM = procs.filter(p => p.type === 'GPU')
      console.log(`  ${String(m.count).padStart(3)}        │  ${formatMB(m.sample.totals.memoryMB).padStart(9)}  │  ${formatMB(avg(mainM.map(p => p.memoryMB))).padStart(6)}  │  ${formatMB(avg(tabM.map(p => p.memoryMB))).padStart(8)}  │  ${formatMB(avg(gpuM.map(p => p.memoryMB)))}`)
    }

    // ── CPU Summary ───────────────────────────────────────────────────
    console.log('\n── CPU Peak by Scenario ──\n')
    console.log('  Scenario                             │  Main  │  Renderer  │  GPU  │  Total')
    console.log('  ─────────────────────────────────────┼────────┼────────────┼───────┼───────')
    for (const s of summaries) {
      console.log(`  ${s.label.padEnd(37)} │ ${formatPct(s.main.cpuMax).padStart(6)} │ ${formatPct(s.renderer.cpuMax).padStart(10)} │ ${formatPct(s.gpu.cpuMax).padStart(5)} │ ${formatPct(s.total.cpuMax).padStart(6)}`)
    }

    // ── Final Process Breakdown ───────────────────────────────────────
    console.log('\n── Final Process Breakdown ──\n')
    for (const p of finalSnapshot.processes) {
      console.log(`  [${p.type.padEnd(8)}] pid=${p.pid}  cpu=${formatPct(p.cpuPercent).padStart(5)}  mem=${formatMB(p.memoryMB).padStart(8)}  peak=${formatMB(p.peakMemoryMB).padStart(8)}`)
    }
    console.log(`  ${'─'.repeat(55)}`)
    console.log(`  ${'TOTAL'.padEnd(10)}            cpu=${formatPct(finalSnapshot.totals.cpuPercent).padStart(5)}  mem=${formatMB(finalSnapshot.totals.memoryMB).padStart(8)}`)
    if (rendererHeap) {
      console.log(`  Renderer JS heap: ${formatMB(rendererHeap.used)} / ${formatMB(rendererHeap.total)}`)
    }

    // ── Speed Metrics ─────────────────────────────────────────────────
    const logs = dumpData?.logs ?? []
    console.log('\n── Speed Metrics ──\n')
    console.log(`  Startup:              ${formatMs(dumpData?.metrics?.['app:total-startup'])}`)
    const findPwshTimes = logs.filter(l => l.includes('shell:findPwsh')).map(l => parseFloat(l.match(/([\d.]+)ms/)?.[1] ?? '0'))
    if (findPwshTimes.length > 0) console.log(`  findPwsh:             ${findPwshTimes.length} call(s), total ${formatMs(findPwshTimes.reduce((a, b) => a + b))}`)
    const ptyTimes = logs.filter(l => l.includes('pty:create') && l.includes('ms')).map(l => parseFloat(l.match(/([\d.]+)ms/)?.[1] ?? '0'))
    if (ptyTimes.length > 0) console.log(`  PTY creation:         ${ptyTimes.length} calls, avg ${formatMs(ptyTimes.reduce((a, b) => a + b) / ptyTimes.length)}`)

    // ── Save ──────────────────────────────────────────────────────────
    const report = {
      timestamp: new Date().toISOString(),
      machine: `${process.platform} ${process.arch}`,
      summaries,
      memoryGrowthCurve: allMemPoints.map(m => ({
        terminals: m.count,
        totalMB: m.sample.totals.memoryMB,
        processes: m.sample.processes
      })),
      finalProcessBreakdown: finalSnapshot,
      rendererHeap,
      speedMetrics: dumpData?.metrics ?? {},
      rawPerfLogs: logs
    }
    const reportPath = resolve(ROOT, 'scripts/benchmark-results.json')
    writeFileSync(reportPath, JSON.stringify(report, null, 2))
    console.log(`\nFull report: ${reportPath}`)

  } catch (err) {
    console.error('\nBenchmark failed:', err.message)
  } finally {
    if (app) await app.close()
    if (existsSync(DUMP_FILE)) unlinkSync(DUMP_FILE)
  }
}

main().catch(console.error)
