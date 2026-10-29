import { describe, expect, it } from 'vitest'
import { layoutPanes } from '../paneLayout'

describe('pane layout', () => {
  it('fills the workspace for one terminal', () => {
    const layout = layoutPanes({ id: 'p1', type: 'leaf', sessionId: 's1' })
    expect(layout.panes).toEqual([{
      leaf: { id: 'p1', type: 'leaf', sessionId: 's1' },
      style: { left: '0%', top: '0%', width: '100%', height: '100%' }
    }])
    expect(layout.splits).toEqual([])
  })

  it('reserves the existing six pixel sash after the first pane', () => {
    const layout = layoutPanes({
      id: 'split', type: 'split', direction: 'horizontal', ratio: 0.6,
      first: { id: 'p1', type: 'leaf', sessionId: 's1' },
      second: { id: 'p2', type: 'leaf', sessionId: 's2' }
    })
    expect(layout.panes.map(pane => pane.style)).toEqual([
      { left: '0%', top: '0%', width: '60%', height: '100%' },
      { left: 'calc(60% + 6px)', top: '0%', width: 'calc(40% - 6px)', height: '100%' }
    ])
    expect(layout.splits[0].style).toEqual({ left: '0%', top: '0%', width: '100%', height: '100%' })
  })

  it('scales inherited gutters when splitting a second pane again', () => {
    const layout = layoutPanes({
      id: 'outer', type: 'split', direction: 'horizontal', ratio: 0.5,
      first: { id: 'p1', type: 'leaf', sessionId: 's1' },
      second: {
        id: 'inner', type: 'split', direction: 'horizontal', ratio: 0.5,
        first: { id: 'p2', type: 'leaf', sessionId: 's2' },
        second: { id: 'p3', type: 'leaf', sessionId: 's3' }
      }
    })
    expect(layout.panes.map(pane => pane.style)).toEqual([
      { left: '0%', top: '0%', width: '50%', height: '100%' },
      { left: 'calc(50% + 6px)', top: '0%', width: 'calc(25% - 3px)', height: '100%' },
      { left: 'calc(75% + 9px)', top: '0%', width: 'calc(25% - 9px)', height: '100%' }
    ])
    expect(layout.splits[1].style).toEqual({
      left: 'calc(50% + 6px)', top: '0%', width: 'calc(50% - 6px)', height: '100%'
    })
  })

  it('keeps each axis independent for mixed nested splits', () => {
    const layout = layoutPanes({
      id: 'outer', type: 'split', direction: 'vertical', ratio: 0.4,
      first: { id: 'p1', type: 'leaf', sessionId: 's1' },
      second: {
        id: 'inner', type: 'split', direction: 'horizontal', ratio: 0.25,
        first: { id: 'p2', type: 'leaf', sessionId: 's2' },
        second: { id: 'p3', type: 'leaf', sessionId: 's3' }
      }
    })
    expect(layout.panes.map(pane => pane.style)).toEqual([
      { left: '0%', top: '0%', width: '100%', height: '40%' },
      { left: '0%', top: 'calc(40% + 6px)', width: '25%', height: 'calc(60% - 6px)' },
      { left: 'calc(25% + 6px)', top: 'calc(40% + 6px)', width: 'calc(75% - 6px)', height: 'calc(60% - 6px)' }
    ])
  })
})
