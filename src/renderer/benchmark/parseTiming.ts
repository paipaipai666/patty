export function observeParsing(
  terminal: unknown,
  record: (elapsedMs: number) => void,
  now = () => performance.now()
): () => void {
  const member = (value: unknown, key: string): unknown =>
    typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined
  const handler = member(member(terminal, '_core'), '_inputHandler')
  const parse = member(handler, 'parse')
  if (typeof handler !== 'object' || handler === null || typeof parse !== 'function') {
    throw new Error('Benchmark requires the pinned xterm input parser')
  }
  const observed = function (this: unknown, ...args: unknown[]): unknown {
    const startedAt = now()
    try {
      return Reflect.apply(parse, this, args)
    } finally {
      record(now() - startedAt)
    }
  }
  Reflect.set(handler, 'parse', observed)
  return () => {
    if (Reflect.get(handler, 'parse') === observed) Reflect.set(handler, 'parse', parse)
  }
}
