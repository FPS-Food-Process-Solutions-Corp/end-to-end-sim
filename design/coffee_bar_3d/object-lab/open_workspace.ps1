$ErrorActionPreference = 'Stop'
$viewerRoot = Split-Path -Parent $PSScriptRoot
$bundledPython = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
$python = if (Test-Path -LiteralPath $bundledPython) { $bundledPython } else { (Get-Command python -ErrorAction Stop).Source }
$listener = Get-NetTCPConnection -LocalPort 8766 -State Listen -ErrorAction SilentlyContinue
if (-not $listener) { New-Item -ItemType Directory -Force -Path "$viewerRoot\output" | Out-Null; Start-Process -FilePath $python -ArgumentList ('"' + $viewerRoot + '\serve_viewer.py"') -WorkingDirectory $viewerRoot -WindowStyle Hidden -RedirectStandardOutput "$viewerRoot\output\object-lab-server.log" -RedirectStandardError "$viewerRoot\output\object-lab-server-errors.log"; Start-Sleep -Milliseconds 700 }
$url = 'http://127.0.0.1:8766/object-lab/'
$probe = Invoke-WebRequest -Uri $url -UseBasicParsing
if ($probe.Content -notmatch 'Object size lab') { throw 'Port 8766 is occupied by a different server.' }
Start-Process $url
Write-Output $url
