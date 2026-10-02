$ErrorActionPreference = 'Stop'
$portable = Join-Path $PSScriptRoot '..\..\.local\blender-runtime\blender-4.5.14-windows-x64\blender.exe'
$installed = Get-Command blender -ErrorAction SilentlyContinue
$blender = if (Test-Path -LiteralPath $portable) { (Resolve-Path -LiteralPath $portable).Path } elseif ($installed) { $installed.Source } else { throw 'Blender was not found. Open output\bakery_cell.blend using Blender 4.5 LTS.' }
Start-Process -FilePath $blender -ArgumentList ('"' + $PSScriptRoot + '\output\bakery_cell.blend"') -WorkingDirectory $PSScriptRoot
