$ErrorActionPreference = 'Stop'
$bundledPython = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
$python = if (Test-Path -LiteralPath $bundledPython) { $bundledPython } else { (Get-Command python -ErrorAction Stop).Source }
$url = 'http://127.0.0.1:8766/viewer.html'
$listener = Get-NetTCPConnection -LocalPort 8766 -State Listen -ErrorAction SilentlyContinue
if (-not $listener) { New-Item -ItemType Directory -Force -Path "$PSScriptRoot\output" | Out-Null; Start-Process -FilePath $python -ArgumentList ('"' + $PSScriptRoot + '\serve_viewer.py"') -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput "$PSScriptRoot\output\viewer-server.log" -RedirectStandardError "$PSScriptRoot\output\viewer-server-errors.log"; Start-Sleep -Milliseconds 700 }
$probe = Invoke-RestMethod -Uri 'http://127.0.0.1:8766/scene_config.json'
if (-not ($probe.objects.id -contains 'nova5')) { throw 'Port 8766 is occupied by a different server.' }
Start-Process $url
Write-Output $url
