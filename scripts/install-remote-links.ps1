param(
    [ValidateSet('RuDesktop', 'Terminal')][string]$Program,
    [string]$ClientPath,
    [string]$RuDesktopPath
)
$ErrorActionPreference = 'Stop'
if ($RuDesktopPath) { $Program = 'RuDesktop'; $ClientPath = $RuDesktopPath }
if (-not $Program) {
    $Program = Read-Host 'Program: RuDesktop or Terminal'
}
if ($Program -notin @('RuDesktop', 'Terminal')) { throw 'Unsupported program.' }
if ($Program -eq 'Terminal' -and -not $ClientPath) {
    $ssh = Get-Command ssh.exe -ErrorAction SilentlyContinue
    if (-not $ssh) { throw 'Enable the Windows OpenSSH Client optional feature first.' }
    $ClientPath = $ssh.Source
}
if (-not $ClientPath) { $ClientPath = (Read-Host 'Full path to the installed program exe').Trim('"') }
if (-not (Test-Path -LiteralPath $ClientPath -PathType Leaf) -or [IO.Path]::GetExtension($ClientPath) -ne '.exe') {
    throw 'Select the installed executable.'
}
$directory = Join-Path $env:LOCALAPPDATA 'WikiHMRU\remote-links'
New-Item -ItemType Directory -Path $directory -Force | Out-Null
$name = $Program.ToLowerInvariant()
(Resolve-Path -LiteralPath $ClientPath).Path | ConvertTo-Json |
    Set-Content -LiteralPath (Join-Path $directory ($name + '.json')) -Encoding UTF8
$launcher = Join-Path $directory 'launch.ps1'
@'
param([string]$ConnectionUri)
$ErrorActionPreference = 'Stop'
if ($ConnectionUri -notmatch '^wikihmru-(rudesktop|terminal):([^\s"<>]+)$') { throw 'Invalid connection link.' }
$program = $Matches[1]
$target = [Uri]::UnescapeDataString($Matches[2])
$client = Get-Content -LiteralPath (Join-Path $PSScriptRoot ($program + '.json')) -Raw | ConvertFrom-Json
if (-not (Test-Path -LiteralPath $client -PathType Leaf)) { throw 'Program was moved. Rerun the installer.' }
if ($program -eq 'rudesktop') {
    if ($target -notmatch '^\d{1,20}/?$') { throw 'Invalid RuDesktop ID.' }
    $arguments = @('--connect', $target.TrimEnd('/'))
} else {
    if ($target -notmatch '^(?:([a-zA-Z0-9_][a-zA-Z0-9_.-]*)@)?([a-zA-Z0-9][a-zA-Z0-9.-]*)(?::(\d{1,5}))?$') { throw 'Invalid SSH address.' }
    $user = $Matches[1]; $hostname = $Matches[2]
    $port = if ($Matches[3]) { [int]$Matches[3] } else { 22 }
    if ($port -lt 1 -or $port -gt 65535) { throw 'Invalid SSH port.' }
    foreach ($label in $hostname.Split('.')) {
        if (-not $label -or $label.StartsWith('-') -or $label.EndsWith('-')) { throw 'Invalid hostname.' }
    }
    if ($hostname -match '^[\d.]+$') {
        $octets = $hostname.Split('.')
        if ($octets.Count -ne 4 -or @($octets | Where-Object { [int]$_ -gt 255 }).Count) { throw 'Invalid IPv4 address.' }
    }
    $destination = if ($user) { $user + '@' + $hostname } else { $hostname }
    $arguments = @('-p', [string]$port, $destination)
}
Start-Process -FilePath $client -ArgumentList $arguments
'@ | Set-Content -LiteralPath $launcher -Encoding UTF8
$protocol = 'HKCU:\Software\Classes\wikihmru-' + $name
New-Item -Path $protocol -Force | Out-Null
Set-Item -Path $protocol -Value ('URL:WikiHMRU ' + $Program + ' connection')
New-ItemProperty -Path $protocol -Name 'URL Protocol' -Value '' -PropertyType String -Force | Out-Null
$command = New-Item -Path ($protocol + '\shell\open\command') -Force
$powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
Set-Item -Path $command.PSPath -Value ('"' + $powershell + '" -NoProfile -ExecutionPolicy Bypass -File "' + $launcher + '" "%1"')
Write-Host "$Program links installed for this Windows user."
