param([string]$RuDesktopPath)
$ErrorActionPreference = 'Stop'
if (-not $RuDesktopPath) {
    $RuDesktopPath = (Read-Host 'Full path to installed rudesktop.exe').Trim('"')
}
if (-not (Test-Path -LiteralPath $RuDesktopPath -PathType Leaf) -or
    [IO.Path]::GetExtension($RuDesktopPath) -ne '.exe') {
    throw 'Select the installed RuDesktop executable.'
}
$RuDesktopPath = (Resolve-Path -LiteralPath $RuDesktopPath).Path
$directory = Join-Path $env:LOCALAPPDATA 'WikiHMRU\remote-links'
New-Item -ItemType Directory -Path $directory -Force | Out-Null
$RuDesktopPath | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $directory 'client.json') -Encoding UTF8
$launcher = Join-Path $directory 'launch.ps1'
@'
param([string]$ConnectionUri)
$ErrorActionPreference = 'Stop'
if ($ConnectionUri -notmatch '^wikihmru-rudesktop:(\d{1,20})/?$') {
    throw 'Invalid WikiHMRU connection link.'
}
$peerId = $Matches[1]
$client = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'client.json') -Raw | ConvertFrom-Json
if (-not (Test-Path -LiteralPath $client -PathType Leaf)) { throw 'RuDesktop was moved. Rerun the installer.' }
Start-Process -FilePath $client -ArgumentList @('--connect', $peerId)
'@ | Set-Content -LiteralPath $launcher -Encoding UTF8
$protocol = 'HKCU:\Software\Classes\wikihmru-rudesktop'
New-Item -Path $protocol -Force | Out-Null
Set-Item -Path $protocol -Value 'URL:WikiHMRU RuDesktop connection'
New-ItemProperty -Path $protocol -Name 'URL Protocol' -Value '' -PropertyType String -Force | Out-Null
$command = New-Item -Path ($protocol + '\shell\open\command') -Force
$powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
Set-Item -Path $command.PSPath -Value ('"' + $powershell + '" -NoProfile -ExecutionPolicy Bypass -File "' + $launcher + '" "%1"')
Write-Host 'RuDesktop links installed for this Windows user. Open an access entry in WikiHMRU and click Connect.'
