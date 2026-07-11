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
    PreToolUse?: NotificationHook[]
    PostToolUse?: NotificationHook[]
    UserPromptSubmit?: NotificationHook[]
    [key: string]: unknown
  }
  [key: string]: unknown
}

// Replace an existing Patty-matching hook entry or append a new one.
function upsertHook(
  hooks: Record<string, unknown>,
  key: string,
  entry: NotificationHook,
  predicate: (n: NotificationHook) => boolean
): void {
  const list = (hooks[key] as NotificationHook[] | undefined) ?? []
  const idx = list.findIndex(predicate)
  if (idx >= 0) list[idx] = entry
  else list.push(entry)
  hooks[key] = list
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

    const hooks = settings.hooks
    const isPattyCmdHook = (n: NotificationHook) =>
      n.hooks?.some((h) => h.command && h.command.includes('patty-hook.ps1'))
    const isPattyArgsHook = (n: NotificationHook) =>
      n.hooks?.some((h) => h.command && h.command.includes('powershell') && h.args?.includes('-EventType'))

    const cmdHook = (matcher: string): NotificationHook => ({
      matcher,
      hooks: [{ type: 'command', command: hookCommand }]
    })
    const argsHook = (matcher: string, eventType: string): NotificationHook => ({
      matcher,
      hooks: [{
        type: 'command',
        command: 'powershell',
        args: ['-ExecutionPolicy', 'Bypass', '-File', hookScriptPath, '-EventType', eventType]
      }]
    })

    upsertHook(hooks, 'Notification', cmdHook(HOOK_MATCHER), isPattyCmdHook)
    upsertHook(hooks, 'Stop', cmdHook(''), isPattyCmdHook)
    upsertHook(hooks, 'StopFailure', cmdHook(STOP_FAILURE_MATCHER), isPattyCmdHook)
    upsertHook(hooks, 'SessionStart', argsHook('startup|resume', 'session_start'), isPattyArgsHook)
    upsertHook(hooks, 'SessionEnd', argsHook('', 'session_end'), isPattyArgsHook)
    upsertHook(hooks, 'PreToolUse', argsHook('', 'pre_tool_use'), isPattyArgsHook)
    upsertHook(hooks, 'PostToolUse', argsHook('', 'post_tool_use'), isPattyArgsHook)
    upsertHook(hooks, 'UserPromptSubmit', argsHook('', 'user_prompt_submit'), isPattyArgsHook)

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

interface CodexHooks {
  hooks?: {
    SessionStart?: NotificationHook[]
    PermissionRequest?: NotificationHook[]
    Stop?: NotificationHook[]
    PreToolUse?: NotificationHook[]
    PostToolUse?: NotificationHook[]
    UserPromptSubmit?: NotificationHook[]
    [key: string]: unknown
  }
  [key: string]: unknown
}

function getCodexSettingsPath(): string {
  const homeDir = process.env.USERPROFILE || process.env.HOME || ''
  return path.join(homeDir, '.codex', 'hooks.json')
}

export async function ensureCodexHook(): Promise<void> {
  try {
    const settingsPath = getCodexSettingsPath()
    const hookScriptPath = ensureHookScriptExists()

    const hookCommand = `powershell -ExecutionPolicy Bypass -File "${hookScriptPath}" -Source "codex"`

    let settings: CodexHooks = {}

    if (fs.existsSync(settingsPath)) {
      try {
        const content = fs.readFileSync(settingsPath, 'utf-8')
        settings = JSON.parse(content)
      } catch {
        settings = {}
      }
    }

    if (!settings.hooks) {
      settings.hooks = {}
    }

    const hooks = settings.hooks
    const isPattyCodexHook = (n: NotificationHook) =>
      n.hooks?.some((h) => h.command && h.command.includes('patty-hook.ps1') && h.command.includes('-Source "codex"'))

    const codexEntry = (matcher: string): NotificationHook => ({
      matcher,
      hooks: [{ type: 'command', command: hookCommand }]
    })

    upsertHook(hooks, 'SessionStart', codexEntry('startup|resume'), isPattyCodexHook)
    upsertHook(hooks, 'PermissionRequest', codexEntry(''), isPattyCodexHook)
    upsertHook(hooks, 'Stop', codexEntry(''), isPattyCodexHook)
    upsertHook(hooks, 'PreToolUse', codexEntry(''), isPattyCodexHook)
    upsertHook(hooks, 'PostToolUse', codexEntry(''), isPattyCodexHook)
    upsertHook(hooks, 'UserPromptSubmit', codexEntry(''), isPattyCodexHook)

    const settingsDir = path.dirname(settingsPath)
    if (!fs.existsSync(settingsDir)) {
      fs.mkdirSync(settingsDir, { recursive: true })
    }

    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8')
    console.log('Codex CLI hook installed successfully')
  } catch (error) {
    console.error('Failed to install Codex CLI hook:', error)
  }
}
