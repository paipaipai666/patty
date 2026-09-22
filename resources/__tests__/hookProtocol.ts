
   
import { readFileSync } from 'node:fs'

interface Protocol {
  sources: string[]
  events: Record<string, string | null>
  patterns: Array<{ prefix?: string; contains?: string; attention: string }>
}

export const protocol: Protocol = JSON.parse(
  readFileSync(new URL('../hook-protocol.json', import.meta.url), 'utf8')
)

                                        
export function isCanonicalEvent(event: string | undefined): boolean {
  if (!event) return false
  if (event in protocol.events) return true
  return protocol.patterns.some(
    (p) => (p.prefix !== undefined && event.startsWith(p.prefix)) ||
      (p.contains !== undefined && event.includes(p.contains))
  )
}
