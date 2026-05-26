# Filflo Bot Server - Cloudflare tunnel launcher.
# Downloads cloudflared if needed, opens a public https tunnel to the bot server
# (port 8765), then AUTO-COPIES the exact URL to the clipboard and saves it to
# BOT_URL.txt so there is no manual copy-paste mistake.
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$cf  = Join-Path $PSScriptRoot 'cloudflared.exe'
$log = Join-Path $PSScriptRoot 'cloudflared.log'

if (-not (Test-Path $cf)) {
  Write-Host 'Downloading cloudflared (one-time, ~50 MB)...'
  Invoke-WebRequest -Uri 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile $cf
}
if (Test-Path $log) { Remove-Item $log -Force -ErrorAction SilentlyContinue }

Write-Host ''
Write-Host 'Make sure bot_server.py is already running (START_BOT_SERVER.bat).'
Write-Host 'Starting Cloudflare tunnel to http://127.0.0.1:8765 ...'
Write-Host ''

$proc = Start-Process -FilePath $cf -ArgumentList 'tunnel','--url','http://127.0.0.1:8765' `
        -RedirectStandardError $log -NoNewWindow -PassThru

$url = $null
for ($i = 0; $i -lt 60 -and -not $url; $i++) {
  Start-Sleep -Seconds 1
  if (Test-Path $log) {
    $m = Select-String -Path $log -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($m) { $url = $m.Matches[0].Value }
  }
}

if ($url) {
  Set-Content -Path (Join-Path $PSScriptRoot 'BOT_URL.txt') -Value $url -Encoding ascii
  try { $url | Set-Clipboard } catch {}
  Write-Host ('=' * 64)
  Write-Host '  BOT SERVER URL  (already copied to your clipboard + BOT_URL.txt)'
  Write-Host "    $url"
  Write-Host '  -> In Command Center, click the Bot Server box, press Ctrl+V, then Test.'
  Write-Host ('=' * 64)
} else {
  Write-Host 'Could not detect the tunnel URL automatically. Open cloudflared.log and'
  Write-Host 'copy the https://....trycloudflare.com line manually.'
}

Write-Host ''
Write-Host 'Tunnel is running. KEEP THIS WINDOW OPEN. Press Ctrl+C to stop.'
Wait-Process -Id $proc.Id
