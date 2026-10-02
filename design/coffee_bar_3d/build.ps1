param([string]$Config = "$PSScriptRoot\scene_config.json", [switch]$Preview, [switch]$NoRender)
$ErrorActionPreference = 'Stop'
$portable = Join-Path $PSScriptRoot '..\..\.local\blender-runtime\blender-4.5.14-windows-x64\blender.exe'
$installed = Get-Command blender -ErrorAction SilentlyContinue
$blender = if (Test-Path -LiteralPath $portable) { (Resolve-Path -LiteralPath $portable).Path } elseif ($installed) { $installed.Source } else { throw 'Blender was not found. Add Blender 4.5 LTS to PATH, or use its full path with build_scene.py.' }
$buildArguments = @('--background', '--python-exit-code', '1', '--python', "$PSScriptRoot\build_scene.py", '--', '--config', (Resolve-Path -LiteralPath $Config).Path)
if ($Preview) { $buildArguments += '--preview' }
if ($NoRender) { $buildArguments += '--no-render' }
& $blender @buildArguments
if ($LASTEXITCODE -ne 0) { throw "Blender exited with code $LASTEXITCODE" }
