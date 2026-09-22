

param(
    [string]$EventType = "",
    [string]$Source = "claude-code"
)


$logFile = "$env:TEMP\patty-hook-debug.log"
function Write-DebugLog($Message) {
    if ($env:PATTY_DEBUG) {
        "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') - $Message" | Out-File -FilePath $logFile -Append
    }
}

Write-DebugLog "Hook triggered (EventType=$EventType)"
Write-DebugLog "PATTY_PANE_ID: $env:PATTY_PANE_ID"
Write-DebugLog "PATTY_PORT: $env:PATTY_PORT"


if (-not $env:PATTY_PANE_ID -or -not $env:PATTY_PORT) {
    Write-DebugLog "Early exit: missing env vars"
    exit 0
}

try {

    $eventType = $EventType

    if (-not $eventType) {

        $stdinInput = [Console]::In.ReadToEnd()
        Write-DebugLog "Stdin input: $stdinInput"

        $eventType = "unknown"
        if ($stdinInput) {
            try {
                $inputData = $stdinInput | ConvertFrom-Json
                if ($inputData.hook_event_name) {

                    $hookName = $inputData.hook_event_name.ToString().ToLower()
                    switch ($hookName) {
                        "sessionstart" { $eventType = "session_start" }
                        "sessionend" { $eventType = "session_end" }
                        "permissionrequest" { $eventType = "permission_prompt" }
                        "stop" { $eventType = "stop" }
                        "agentstop" { $eventType = "stop" }
                        "erroroccurred" { $eventType = "error" }

                        "pretooluse" { $eventType = "pre_tool_use" }
                        "posttooluse" { $eventType = "post_tool_use" }
                        "userpromptsubmit" { $eventType = "user_prompt_submit" }
                        "userpromptsubmitted" { $eventType = "user_prompt_submit" }
                        "notification" {

                            if ($inputData.notification_type) {
                                $eventType = $inputData.notification_type.ToString()
                            } elseif ($inputData.message -match 'permission') {
                                $eventType = "permission_prompt"
                            } else {
                                $eventType = "notification"
                            }
                        }
                        "stopfailure" {

                            if ($inputData.type) { $eventType = "error_$($inputData.type)" }
                            elseif ($inputData.error_type) { $eventType = "error_$($inputData.error_type)" }
                            else { $eventType = "error" }
                        }
                        default { $eventType = $hookName }
                    }
                } elseif ($inputData.event) {

                    $eventType = $inputData.event.ToString().ToLower()
                    switch ($eventType) {
                        "sessionstart" { $eventType = "session_start" }
                        "sessionend" { $eventType = "session_end" }
                        "pretooluse" { $eventType = "pre_tool_use" }
                        "posttooluse" { $eventType = "post_tool_use" }
                        "agentstop" { $eventType = "stop" }
                        "erroroccurred" { $eventType = "error" }
                        "userpromptsubmitted" { $eventType = "user_prompt_submit" }
                        default { }
                    }
                } elseif ($inputData.notification_type) {

                    $eventType = $inputData.notification_type
                } elseif ($inputData.reason) {

                    $eventType = "session_end"
                } elseif ($inputData.type) {

                    $eventType = "error_$($inputData.type)"
                } elseif ($inputData.error_type) {

                    $eventType = "error_$($inputData.error_type)"
                }
            } catch {

                $eventType = "stop"
            }
        } else {

            $eventType = "stop"
        }
    }

    Write-DebugLog "Event type: $eventType"


    $body = @{
        paneId = $env:PATTY_PANE_ID
        event  = $eventType
        source = $Source
        secret = $env:PATTY_HOOK_SECRET
    } | ConvertTo-Json -Compress

    Write-DebugLog "Source: $Source"


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