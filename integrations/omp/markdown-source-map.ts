interface SourceToken {
  type: string
  raw: string
  text?: string
  tokens?: readonly SourceToken[]
  items?: readonly SourceToken[]
  header?: readonly { text: string; tokens: readonly SourceToken[] }[]
  rows?: readonly (readonly { text: string; tokens: readonly SourceToken[] }[])[]
}

const marker = /\x1b\]777;omp-source;(\d+)\x07/g
const ansi = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[PX_^][\s\S]*?\x1b\\|[@-_])/y
const stripAnsi = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[PX_^][\s\S]*?\x1b\\|[@-_])/g
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

export interface SourceRow {
  text: string
  start: number | undefined
  end: number | undefined
}

export function sourceRows(lines: readonly string[], source?: string): SourceRow[] {
  const rows = lines.map(line => {
    let start: number | undefined
    let end: number | undefined
    const text = line.replace(marker, (_match, offset: string) => {
      const point = Number(offset)
      start = start === undefined ? point : Math.min(start, point)
      end = end === undefined ? point : Math.max(end, point)
      return ''
    })
    return { text, start, end }
  })
  if (source === undefined || rows.some(row => row.start !== undefined)) return rows
  const { text: normalizedText, positions } = normalized(source)
  let cursor = 0
  let previous = 0
  return rows.map((row, index) => {
    const plain = (lines[index] ?? '').replace(stripAnsi, '')
    const trimmed = plain.trimStart()
    if (trimmed.trimEnd() === '') return { text: row.text, start: previous, end: previous }
    const located = locate(trimmed, normalizedText, positions, cursor)
    const start = located.indices[0] ?? previous
    const end = located.indices[located.indices.length - 1] ?? start
    cursor = located.next
    previous = start
    return { text: row.text, start, end }
  })
}

function normalized(source: string): { text: string; positions: number[] } {
  let text = ''
  const positions: number[] = []
  for (let index = 0; index < source.length; index++) {
    const character = source[index] ?? ''
    const expanded = character === '\t' ? '    ' : character
    text += expanded
    for (let unit = 0; unit < expanded.length; unit++) positions.push(index)
  }
  return { text, positions }
}

function locate(fragment: string, parent: string, positions: readonly number[], from: number): { indices: number[]; next: number } {
  const exact = parent.indexOf(fragment, from)
  if (exact >= 0) return { indices: positions.slice(exact, exact + fragment.length), next: exact + fragment.length }
  const indices: number[] = []
  let cursor = from
  for (const character of fragment) {
    const found = parent.indexOf(character, cursor)
    if (found >= 0) cursor = found
    for (let unit = 0; unit < character.length; unit++) indices.push(positions[cursor + unit] ?? positions.at(-1) ?? 0)
    cursor = Math.min(parent.length, cursor + character.length)
  }
  return { indices, next: cursor }
}

function inject(text: string, positions: readonly number[]): string {
  if (!positions.length || text.includes('\x1b]777;omp-source;')) return text
  let result = ''
  let input = 0
  let visible = 0
  while (input < text.length) {
    ansi.lastIndex = input
    const control = ansi.exec(text)
    if (control) { result += control[0]; input += control[0].length; continue }
    const nextEscape = text.indexOf('\x1b', input)
    const end = nextEscape < 0 ? text.length : nextEscape
    const plain = text.slice(input, Math.max(input + 1, end))
    for (const { segment } of graphemes.segment(plain)) {
      if (segment !== '\n' && segment !== '\r\n') result += `\x1b]777;omp-source;${positions[visible] ?? positions.at(-1) ?? 0}\x07`
      result += segment
      visible += segment.length
    }
    input += plain.length
  }
  return result
}

export class MarkdownSourceMap {
  #positions = new WeakMap<object, readonly number[]>()
  #source: string
  #sourcePositions: readonly number[]

  constructor(source: string) {
    const expanded = normalized(source)
    this.#source = expanded.text
    this.#sourcePositions = expanded.positions
  }

  index(tokens: readonly SourceToken[]): void {
    this.#index(tokens, this.#source, this.#sourcePositions)
  }

  #index(tokens: readonly SourceToken[], parent: string, parentPositions: readonly number[]): void {
    let cursor = 0
    for (const token of tokens) {
      const located = locate(token.raw, parent, parentPositions, cursor)
      cursor = located.next
      this.#positions.set(token, located.indices)
      if (token.tokens) this.#index(token.tokens, token.raw, located.indices)
      if (token.items) this.#index(token.items, token.raw, located.indices)
      let cellCursor = 0
      const cells = [...token.header ?? [], ...(token.rows?.flat() ?? [])]
      for (const cell of cells) {
        const cellSource = locate(cell.text, token.raw, located.indices, cellCursor)
        cellCursor = cellSource.next
        this.#index(cell.tokens, cell.text, cellSource.indices)
      }
    }
  }

  mark(token: SourceToken, rendered: string): string {
    const positions = this.#positions.get(token)
    if (!positions || rendered.includes('\x1b]777;omp-source;')) return rendered
    const plain = rendered.replace(/\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[PX_^][\s\S]*?\x1b\\|[@-_])/g, '')
    return inject(rendered, locate(plain, token.raw, positions, 0).indices)
  }

  codeLine(token: SourceToken, rendered: string, lineIndex: number): string {
    const positions = this.#positions.get(token)
    if (!positions) return rendered
    const body = token.text ?? ''
    const opener = /^ {0,3}(?:`{3,}|~{3,})[^\n]*\n/.exec(token.raw)
    const bodyPositions = locate(body, token.raw, positions, opener?.[0].length ?? 0).indices
    let offset = 0
    for (let line = 0; line < lineIndex; line++) {
      const newline = body.indexOf('\n', offset)
      offset = newline < 0 ? body.length : newline + 1
    }
    const end = body.indexOf('\n', offset)
    const sourceLine = body.slice(offset, end < 0 ? body.length : end)
    const plain = rendered.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    const indentation = Math.max(0, plain.length - sourceLine.length)
    const map = [...Array.from({ length: indentation }, () => bodyPositions[offset] ?? positions[0] ?? 0), ...bodyPositions.slice(offset, offset + sourceLine.length)]
    return inject(rendered, map)
  }
}
