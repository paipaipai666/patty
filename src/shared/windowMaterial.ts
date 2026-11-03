export type WindowMaterial = 'solid' | 'mica'

export interface WindowMaterialRequest {
  enabled: boolean
  appearance: 'dark' | 'light'
  background: [number, number, number]
}

export function parseWindowMaterial(value: unknown): WindowMaterial {
  if (value === 'solid' || value === 'mica') return value
  throw new Error('Invalid window material response')
}
