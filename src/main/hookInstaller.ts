import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'

const HOOK_MATCHER = 'permission_prompt|idle_prompt|elicitation_dialog'
const STOP_FAILURE_MATCHER = 'rate_limit|overloaded|authentication_failed|oauth_org_not_allowed|billing_error|invalid_request|model_not_found|server_error|max_output_tokens|unknown'

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
  args?: string[]
}

interface NotificationHook {
  matcher: string
  hooks: HookEntry[]
}

interface ClaudeSettings {
  hooks?: {
    Notification?: NotificationHook[]
    Stop?: NotificationHook[]
    StopFailure?: NotificationHook[]
    SessionStart?: NotificationHook[]
    SessionEnd?: NotificationHook[]
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

    // Also add StopFailure hook for API errors
    const stopFailureHooks = settings.hooks.StopFailure || []
    const existingStopFailurePattyIndex = stopFailureHooks.findIndex(
      (n) => n.hooks?.some((h) => h.command && h.command.includes('patty-hook.ps1'))
    )

    const newStopFailureHookEntry: NotificationHook = {
      matcher: STOP_FAILURE_MATCHER,
      hooks: [
        {
          type: 'command',
          command: hookCommand
        }
      ]
    }

    if (existingStopFailurePattyIndex >= 0) {
      stopFailureHooks[existingStopFailurePattyIndex] = newStopFailureHookEntry
    } else {
      stopFailureHooks.push(newStopFailureHookEntry)
    }

    settings.hooks.StopFailure = stopFailureHooks

    // SessionStart hook — detect when Claude Code session begins
    const sessionStartHooks = settings.hooks.SessionStart || []
    const existingStartPattyIndex = sessionStartHooks.findIndex(
      (n) => n.hooks?.some((h) => h.command && h.command.includes('powershell') && h.args?.includes('-EventType'))
    )
    const newSessionStartHookEntry: NotificationHook = {
      matcher: 'startup|resume',
      hooks: [
        {
          type: 'command',
          command: 'powershell',
          args: [
            '-ExecutionPolicy', 'Bypass',
            '-File', hookScriptPath,
            '-EventType', 'session_start'
          ]
        }
      ]
    }
    if (existingStartPattyIndex >= 0) {
      sessionStartHooks[existingStartPattyIndex] = newSessionStartHookEntry
    } else {
      sessionStartHooks.push(newSessionStartHookEntry)
    }
    settings.hooks.SessionStart = sessionStartHooks

    // SessionEnd hook — detect when Claude Code session ends
    const sessionEndHooks = settings.hooks.SessionEnd || []
    const existingEndPattyIndex = sessionEndHooks.findIndex(
      (n) => n.hooks?.some((h) => h.command && h.command.includes('powershell') && h.args?.includes('-EventType'))
    )
    const newSessionEndHookEntry: NotificationHook = {
      matcher: '',
      hooks: [
        {
          type: 'command',
          command: 'powershell',
          args: [
            '-ExecutionPolicy', 'Bypass',
            '-File', hookScriptPath,
            '-EventType', 'session_end'
          ]
        }
      ]
    }
    if (existingEndPattyIndex >= 0) {
      sessionEndHooks[existingEndPattyIndex] = newSessionEndHookEntry
    } else {
      sessionEndHooks.push(newSessionEndHookEntry)
    }
    settings.hooks.SessionEnd = sessionEndHooks

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

export async function ensureOpenCodePlugin(): Promise<void> {
  try {
    const sourcePath = app.isPackaged
      ? path.join(process.resourcesPath, 'resources', 'opencode-patty-plugin.ts')
      : path.join(__dirname, '../../resources/opencode-patty-plugin.ts')

    const destDir = path.join(
      process.env.USERPROFILE || '',
      '.config', 'opencode', 'plugins'
    )
    const destPath = path.join(destDir, 'patty-notifier.ts')

    // Create destination directory if it doesn't exist
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true })
    }

    // Copy plugin file
    if (fs.existsSync(sourcePath)) {
      fs.copyFileSync(sourcePath, destPath)
      console.log('OpenCode plugin installed successfully')
    } else {
      console.warn('OpenCode plugin source not found:', sourcePath)
    }
  } catch (error) {
    console.error('Failed to install OpenCode plugin:', error)
  }
}
