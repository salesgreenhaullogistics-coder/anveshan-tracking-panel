$ErrorActionPreference = "Stop"

$botDir = "C:\Users\lenovo\Desktop\Filflo_Bot"
$pythonExe = "C:\Python314\python.exe"
$logDir = Join-Path $botDir "logs"
$logPath = Join-Path $logDir "filflo_slack_bridge_autostart.log"
$runtimeOutLogPath = Join-Path $logDir "filflo_slack_bridge_runtime.out.log"
$runtimeErrLogPath = Join-Path $logDir "filflo_slack_bridge_runtime.err.log"

if (-not (Test-Path $logDir)) {
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
}

function Write-LauncherLog {
    param([string]$Message)
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Add-Content -Path $logPath -Value "$timestamp $Message"
}

try {
    $existing = Get-CimInstance Win32_Process |
        Where-Object {
            $_.Name -eq "python.exe" -and
            $_.CommandLine -match "filflo_chat.py --slack"
        }

    if ($existing) {
        Write-LauncherLog "Slack bridge already running. Skipping autostart."
        exit 0
    }

    foreach ($key in @("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy")) {
        Remove-Item "Env:$key" -ErrorAction SilentlyContinue
    }

    Set-Location $botDir

    $process = Start-Process `
        -FilePath $pythonExe `
        -ArgumentList "filflo_chat.py --slack" `
        -WorkingDirectory $botDir `
        -WindowStyle Hidden `
        -RedirectStandardOutput $runtimeOutLogPath `
        -RedirectStandardError $runtimeErrLogPath `
        -PassThru

    Start-Sleep -Seconds 2
    if ($process.HasExited) {
        Write-LauncherLog "Slack bridge exited during startup. See $runtimeOutLogPath and $runtimeErrLogPath for details."
        exit 1
    }

    Write-LauncherLog "Slack bridge started successfully. PID=$($process.Id)"
}
catch {
    Write-LauncherLog "Autostart failed: $($_.Exception.Message)"
    throw
}
