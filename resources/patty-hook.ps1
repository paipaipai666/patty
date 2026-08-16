# patty-hook.ps1 - AI CLI Notification Hook for Patty
# This script is called by Claude Code or Codex CLI when a notification event occurs.
# It sends the event to the Patty main process via HTTP POST.
#
# Supported events:
# - SessionStart: agent session started/ resumed
# - SessionEnd: agent session terminated (Claude Code)
# - Notification: permission_prompt, idle_prompt, elicitation_dialog (Claude Code)
# - Stop: agent finished answering
# - StopFailure: API errors (rate_limit, overloaded, server_error, etc.) (Claude Code)
# - PermissionRequest: tool approval request (Codex CLI)
#
# Usage:
#   Claude Code: powershell -ExecutionPolicy Bypass -File patty-hook.ps1
#   Codex CLI:   powershell -ExecutionPolicy Bypass -File patty-hook.ps1 -Source "codex"

param(
    [string]$EventType = "",
    [string]$Source = "claude-code"
)

# Debug logging is opt-in via $env:PATTY_DEBUG (off by default) so the hook
# doesn't append to the temp log unboundedly on every AI notification.
$logFile = "$env:TEMP\patty-hook-debug.log"
function Write-DebugLog($Message) {
    if ($env:PATTY_DEBUG) {
        "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') - $Message" | Out-File -FilePath $logFile -Append
    }
}

Write-DebugLog "Hook triggered (EventType=$EventType)"
Write-DebugLog "PATTY_PANE_ID: $env:PATTY_PANE_ID"
Write-DebugLog "PATTY_PORT: $env:PATTY_PORT"

# Early exit if not running in Patty environment
if (-not $env:PATTY_PANE_ID -or -not $env:PATTY_PORT) {
    Write-DebugLog "Early exit: missing env vars"
    exit 0
}

try {
    # If EventType was passed as parameter, use it directly
    $eventType = $EventType

    if (-not $eventType) {
        # Read JSON input from stdin (Claude Code sends notification data)
        $stdinInput = [Console]::In.ReadToEnd()
        Write-DebugLog "Stdin input: $stdinInput"

        $eventType = "unknown"
        if ($stdinInput) {
            try {
                $inputData = $stdinInput | ConvertFrom-Json
                if ($inputData.hook_event_name) {
                    # Codex CLI hook events: SessionStart, PermissionRequest, Stop, etc.
                    $hookName = $inputData.hook_event_name.ToString().ToLower()
                    switch ($hookName) {
                        "sessionstart" { $eventType = "session_start" }
                        "permissionrequest" { $eventType = "permission_prompt" }
                        "stop" { $eventType = "stop" }
                        # Codex 以 PascalCase 上报这些事件；归一化到与 Claude 侧
                        # -EventType 一致的下划线规范名，避免词汇表漂移。
                        "pretooluse" { $eventType = "pre_tool_use" }
                        "posttooluse" { $eventType = "post_tool_use" }
                        "userpromptsubmit" { $eventType = "user_prompt_submit" }
                        "notification" {
                            # Claude Code 2.x 的 Notification 载荷同时带 hook_event_name
                            # 和 notification_type（permission_prompt / idle_prompt /
                            # elicitation_dialog）。必须先读子字段——否则事件退化成无
                            # 意义的 "notification"，权限/提问的蓝灯永远不亮。
                            if ($inputData.notification_type) {
                                $eventType = $inputData.notification_type.ToString()
                            } elseif ($inputData.message -match 'permission') {
                                $eventType = "permission_prompt"
                            } else {
                                $eventType = "notification"
                            }
                        }
                        "stopfailure" {
                            # 同理：2.x StopFailure 的错误类型在 type / error_type 子字段。
                            if ($inputData.type) { $eventType = "error_$($inputData.type)" }
                            elseif ($inputData.error_type) { $eventType = "error_$($inputData.error_type)" }
                            else { $eventType = "error" }
                        }
                        default { $eventType = $hookName }
                    }
                } elseif ($inputData.notification_type) {
                    # Notification hook: permission_prompt, idle_prompt, elicitation_dialog
                    $eventType = $inputData.notification_type
                } elseif ($inputData.reason) {
                    # SessionEnd hook: clear, resume, logout, prompt_input_exit, etc.
                    $eventType = "session_end"
                } elseif ($inputData.type) {
                    # StopFailure hook: rate_limit, overloaded, server_error, etc.
                    $eventType = "error_$($inputData.type)"
                } elseif ($inputData.error_type) {
                    # Alternative error format
                    $eventType = "error_$($inputData.error_type)"
                }
            } catch {
                # If JSON parsing fails, use stdin as event type
                $eventType = "stop"
            }
        } else {
            # No input means Stop hook
            $eventType = "stop"
        }
    }

    Write-DebugLog "Event type: $eventType"

    # Build request body
    $body = @{
        paneId = $env:PATTY_PANE_ID
        event  = $eventType
        source = $Source
        secret = $env:PATTY_HOOK_SECRET
    } | ConvertTo-Json -Compress

    Write-DebugLog "Source: $Source"

    # Send notification to Patty main process
    $response = Invoke-RestMethod `
        -Uri "http://127.0.0.1:$env:PATTY_PORT/hook" `
        -Method Post `
        -Body $body `
        -ContentType 'application/json' `
        -TimeoutSec 2

    Write-DebugLog "Response: $($response | ConvertTo-Json -Compress)"
} catch {
    Write-DebugLog "Error: $_"
    Write-DebugLog "Stack trace: $($_.ScriptStackTrace)"
}

exit 0