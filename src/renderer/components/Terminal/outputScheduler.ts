type Work = (complete: () => void) => void

interface Lane {
  id: number
  visible: boolean
  closed: boolean
  running: boolean
  yielded: boolean
  work: Work[]
}

function taskQueue(): (task: () => void) => void {
  const channel = new MessageChannel()
  const tasks: Array<() => void> = []
  channel.port1.onmessage = () => tasks.shift()?.()
  return (task) => {
    tasks.push(task)
    channel.port2.postMessage(null)
  }
}

export function createOutputScheduler(postTask?: (task: () => void) => void, hiddenBatchSize = 8) {
  const lanes = new Map<number, Lane>()
  let nextId = 0
  let cursor = 0
  let posted = false
  let post = postTask

  const schedule = () => {
    if (posted || ![...lanes.values()].some((lane) => !lane.visible && lane.work.length)) return
    if ([...lanes.values()].some((lane) => !lane.visible && lane.running && !lane.yielded)) return
    posted = true
    post ??= taskQueue()
    post(() => {
      posted = false
      if ([...lanes.values()].some((lane) => !lane.visible && lane.running && !lane.yielded)) return
      const available = [...lanes].filter(([, lane]) => !lane.visible && !lane.running && lane.work.length)
      const choice = available.find(([id]) => id > cursor) ?? available[0]
      if (!choice) return
      const [id, lane] = choice
      cursor = id
      start(lane)
    })
  }

  const start = (lane: Lane) => {
    if (lane.closed || lane.running) return
    const batch = lane.work.splice(0, lane.visible ? 1 : hiddenBatchSize)
    if (!batch.length) return
    lane.running = true
    lane.yielded = false
    let remaining = batch.length
    const yieldTimer = setTimeout(() => {
      if (lane.closed || !lane.running) return
      lane.yielded = true
      schedule()
    }, 8)
    const complete = () => {
      if (lane.closed) return
      if (--remaining) return
      clearTimeout(yieldTimer)
      lane.running = false
      if (!lane.closed && lane.visible) start(lane)
      schedule()
    }
    for (const work of batch) {
      let finished = false
      const done = () => {
        if (finished) return
        finished = true
        complete()
      }
      try {
        work(done)
      } catch (error) {
        clearTimeout(yieldTimer)
        lane.closed = true
        lane.running = false
        lane.work.length = 0
        lanes.delete(lane.id)
        schedule()
        throw error
      }
    }
  }

  return {
    open(visible: boolean) {
      const id = ++nextId
      const lane: Lane = { id, visible, closed: false, running: false, yielded: false, work: [] }
      lanes.set(id, lane)
      return {
        push(work: Work) {
          if (lane.closed) return
          lane.work.push(work)
          if (lane.visible) start(lane)
          else schedule()
        },
        setVisible(visible: boolean) {
          if (lane.closed || lane.visible === visible) return
          lane.visible = visible
          if (visible) start(lane)
          schedule()
        },
        dispose() {
          if (lane.closed) return
          lane.closed = true
          lane.work.length = 0
          lanes.delete(id)
          schedule()
        }
      }
    }
  }
}

export const terminalOutputScheduler = createOutputScheduler()
