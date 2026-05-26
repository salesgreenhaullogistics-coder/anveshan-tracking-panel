$ErrorActionPreference = "Stop"

$botDir = "C:\Users\lenovo\Desktop\Filflo_Bot"
$pythonExe = "C:\Python314\python.exe"

Set-Location $botDir
$Host.UI.RawUI.WindowTitle = "Filflo Monitor"

Write-Host "Starting Filflo Monitor..." -ForegroundColor Cyan
Write-Host "Keep this window open to watch bot progress." -ForegroundColor DarkGray
Write-Host ""

& $pythonExe "filflo_monitor.py"
