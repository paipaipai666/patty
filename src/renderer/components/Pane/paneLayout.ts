import type { PaneLeaf, PaneSplit, PaneTree } from '../../../shared/paneTypes'

interface Length {
  percent: number
  pixels: number
}

interface Rect {
  left: Length
  top: Length
  width: Length
  height: Length
}

interface RectStyle {
  left: string
  top: string
  width: string
  height: string
}

interface PaneLayout {
  panes: Array<{ leaf: PaneLeaf; style: RectStyle }>
  splits: Array<{ split: PaneSplit; style: RectStyle }>
}

const SASH_PX = 6

function scale(length: Length, ratio: number): Length {
  return { percent: length.percent * ratio, pixels: length.pixels * ratio }
}

function add(a: Length, b: Length): Length {
  return { percent: a.percent + b.percent, pixels: a.pixels + b.pixels }
}

function cssLength(length: Length): string {
  const percent = Number(length.percent.toFixed(6))
  const pixels = Number(length.pixels.toFixed(6))
  if (pixels === 0) return `${percent}%`
  return `calc(${percent}% ${pixels < 0 ? '-' : '+'} ${Math.abs(pixels)}px)`
}

function rectStyle(rect: Rect): RectStyle {
  return {
    left: cssLength(rect.left),
    top: cssLength(rect.top),
    width: cssLength(rect.width),
    height: cssLength(rect.height)
  }
}

export function layoutPanes(tree: PaneTree): PaneLayout {
  const layout: PaneLayout = { panes: [], splits: [] }

  function visit(node: PaneTree, rect: Rect): void {
    if (node.type === 'leaf') {
      layout.panes.push({ leaf: node, style: rectStyle(rect) })
      return
    }

    layout.splits.push({ split: node, style: rectStyle(rect) })
    const extent = node.direction === 'horizontal' ? rect.width : rect.height
    const firstExtent = scale(extent, node.ratio)
    const secondExtent = add(scale(extent, 1 - node.ratio), { percent: 0, pixels: -SASH_PX })
    const secondOffset = add(firstExtent, { percent: 0, pixels: SASH_PX })

    if (node.direction === 'horizontal') {
      visit(node.first, { ...rect, width: firstExtent })
      visit(node.second, { ...rect, left: add(rect.left, secondOffset), width: secondExtent })
    } else {
      visit(node.first, { ...rect, height: firstExtent })
      visit(node.second, { ...rect, top: add(rect.top, secondOffset), height: secondExtent })
    }
  }

  visit(tree, {
    left: { percent: 0, pixels: 0 },
    top: { percent: 0, pixels: 0 },
    width: { percent: 100, pixels: 0 },
    height: { percent: 100, pixels: 0 }
  })
  return layout
}
