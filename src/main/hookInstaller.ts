import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'

const HOOK_MATCHER = 'permission_prompt|idle_prompt|elicitation_dialog'

function getClaudeSettingsPath(): string {
  const homeDir = process.env.USERPROFILE || process.env.HOME || ''
  return path.join(homeDir, '.claude', 'settings.json')
}

function getHookScriptPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'resources', 'patty-hook.ps1')
  }
  return path.join(__dirname, '../../resources/patty-hook.ps1')
}

function getInstalledHookPath(): string {
  const appData = process.env.APPDATA || ''
  return path.join(appData, 'Patty', 'patty-hook.ps1')
}

function ensureHookScriptExists(): string {
  const sourcePath = getHookScriptPath()
  const destPath = getInstalledHookPath()

  // Create destination directory if it doesn't exist
  const destDir = path.dirname(destPath)
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true })
  }

  // Copy hook script to AppData
  if (fs.existsSync(sourcePath)) {
    fs.copyFileSync(sourcePath, destPath)
  }

  return destPath
}

interface HookEntry {
  type: string
  command: string
}

interface NotificationHook {
  matcher: string
  hooks: HookEntry[]
}

interface ClaudeSettings {
  hooks?: {
    Notification?: NotificationHook[]
    Stop?: NotificationHook[]
    [key: string]: unknown
  }
  [key: string]: unknown
}

export async function ensureClaudeCodeHook(hookPort: number): Promise<void> {
  try {
    const settingsPath = getClaudeSettingsPath()
    const hookScriptPath = ensureHookScriptExists()

    // Build the command for the hook
    const hookCommand = `powershell -ExecutionPolicy Bypass -File "${hookScriptPath}"`

    let settings: ClaudeSettings = {}

    // Read existing settings if they exist
    if (fs.existsSync(settingsPath)) {
      try {
        const content = fs.readFileSync(settingsPath, 'utf-8')
        settings = JSON.parse(content)
      } catch {
        // If parsing fails, start with empty settings
        settings = {}
      }
    }

    // Ensure hooks structure exists
    if (!settings.hooks) {
      settings.hooks = {}
    }

    // Find existing Patty hook entry
    const notifications = settings.hooks.Notification || []
    const existingPattyIndex = notifications.findIndex(
      (n) => n.hooks?.some((h) => h.command && h.command.includes('patty-hook.ps1'))
    )

    const newHookEntry: NotificationHook = {
      matcher: HOOK_MATCHER,
      hooks: [
        {
          type: 'command',
          command: hookCommand
        }
      ]
    }

    if (existingPattyIndex >= 0) {
      // Replace existing Patty hook
      notifications[existingPattyIndex] = newHookEntry
    } else {
      // Add new Patty hook
      notifications.push(newHookEntry)
    }

    settings.hooks.Notification = notifications

    // Also add Stop hook for when agent finishes answering
    const stopHooks = settings.hooks.Stop || []
    const existingStopPattyIndex = stopHooks.findIndex(
      (n) => n.hooks?.some((h) => h.command && h.command.includes('patty-hook.ps1'))
    )

    const newStopHookEntry: NotificationHook = {
      matcher: '',
      hooks: [
        {
          type: 'command',
          command: hookCommand
        }
      ]
    }

    if (existingStopPattyIndex >= 0) {
      stopHooks[existingStopPattyIndex] = newStopHookEntry
    } else {
      stopHooks.push(newStopHookEntry)
    }

    settings.hooks.Stop = stopHooks

    // Ensure settings directory exists
    const settingsDir = path.dirname(settingsPath)
    if (!fs.existsSync(settingsDir)) {
      fs.mkdirSync(settingsDir, { recursive: true })
    }

    // Write updated settings
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8')

    console.log('Claude Code hook installed successfully')
  } catch (error) {
    console.error('Failed to install Claude Code hook:', error)
  }
}
