import type { Terminal } from '@oh-my-pi/pi-tui/terminal'

export class FixtureTerminal implements Terminal {
  columns = 100
  rows = 28
  kittyProtocolActive = false
  kittyEnableSequence = null
  appearance = undefined
  output = ''
  input: (data: string) => void = () => {}
  resize: () => void = () => {}

  constructor(private readonly emit: (data: string) => void = () => {}) {}

  start(input: (data: string) => void, resize: () => void): void {
    this.input = input
    this.resize = resize
  }

  stop(): void {}
  async drainInput(): Promise<void> {}
  write(data: string): void { this.output += data; this.emit(data) }
  moveBy(lines: number): void { if (lines) this.write(`\x1b[${Math.abs(lines)}${lines < 0 ? 'A' : 'B'}`) }
  hideCursor(): void { this.write('\x1b[?25l') }
  showCursor(): void { this.write('\x1b[?25h') }
  clearLine(): void { this.write('\x1b[2K') }
  clearFromCursor(): void { this.write('\x1b[J') }
  clearScreen(): void { this.write('\x1b[2J\x1b[H') }
  setTitle(): void {}
  setProgress(): void {}
  onAppearanceChange(): void {}
}
