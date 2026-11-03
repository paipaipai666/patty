import type { AppCommand } from '../../commands/applicationCommands'

export function filterCommands(commands: AppCommand[], query: string): AppCommand[] {
  const normalize = (text: string) => text.normalize('NFKC').toLowerCase().replaceAll('\\', '/')
  const words = normalize(query).trim().split(/\s+/).filter(Boolean)
  return commands.filter(command => {
    const text = normalize([command.label, command.group, command.description, command.keywords, command.shortcut].join('\n'))
    return words.every(word => text.includes(word))
  })
}
