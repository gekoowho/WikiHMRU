param(
    [ValidateSet('AnyDesk', 'RuDesktop', 'Terminal')][string]$Program,
    [string]$ClientPath,
    [string]$RuDesktopPath
)
$ErrorActionPreference = 'Stop'
if ($RuDesktopPath) { $Program = 'RuDesktop'; $ClientPath = $RuDesktopPath }
if (-not $Program) {
    $Program = Read-Host 'Program: AnyDesk, RuDesktop or Terminal'
}
if ($Program -notin @('AnyDesk', 'RuDesktop', 'Terminal')) { throw 'Unsupported program.' }
if ($Program -eq 'Terminal' -and -not $ClientPath) {
    $ssh = Get-Command ssh.exe -ErrorAction SilentlyContinue
    if (-not $ssh) { throw 'Enable the Windows OpenSSH Client optional feature first.' }
    $ClientPath = $ssh.Source
}
if (-not $ClientPath -and $Program -ne 'Terminal') {
    $exeName = if ($Program -eq 'AnyDesk') { 'AnyDesk.exe' } else { 'rudesktop.exe' }
    $candidates = @()
    foreach ($root in @($env:ProgramFiles, ${env:ProgramFiles(x86)}, $env:LOCALAPPDATA)) {
        if ($root) { $candidates += (Join-Path $root ($Program + '\' + $exeName)) }
    }
    $found = $candidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
    if ($found) { $ClientPath = $found }
    else {
        Add-Type -AssemblyName System.Windows.Forms
        $picker = New-Object System.Windows.Forms.OpenFileDialog
        $picker.Title = 'Select ' + $Program + ' executable'
        $picker.Filter = 'Application (*.exe)|*.exe'
        if ($picker.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { $ClientPath = $picker.FileName }
        $picker.Dispose()
    }
}
if (-not $ClientPath) { throw 'No executable selected. Setup cancelled.' }
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
if ($ConnectionUri -match '^anydesk:([^\s"<>]+)$') {
    $program = 'anydesk'; $encodedTarget = $Matches[1]
} elseif ($ConnectionUri -match '^wikihmru-(rudesktop|terminal):([^\s"<>]+)$') {
    $program = $Matches[1]; $encodedTarget = $Matches[2]
} else { throw 'Invalid connection link.' }
$target = [Uri]::UnescapeDataString($encodedTarget)
$client = Get-Content -LiteralPath (Join-Path $PSScriptRoot ($program + '.json')) -Raw | ConvertFrom-Json
if (-not (Test-Path -LiteralPath $client -PathType Leaf)) { throw 'Program was moved. Rerun the installer.' }
if ($program -eq 'anydesk') {
    if ($target -notmatch '^[a-zA-Z0-9][a-zA-Z0-9@._-]{0,127}$') { throw 'Invalid AnyDesk ID or alias.' }
    $arguments = @($target)
} elseif ($program -eq 'rudesktop') {
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
$scheme = if ($Program -eq 'AnyDesk') { 'anydesk' } else { 'wikihmru-' + $name }
$protocol = 'HKCU:\Software\Classes\' + $scheme
New-Item -Path $protocol -Force | Out-Null
Set-Item -Path $protocol -Value ('URL:WikiHMRU ' + $Program + ' connection')
New-ItemProperty -Path $protocol -Name 'URL Protocol' -Value '' -PropertyType String -Force | Out-Null
$command = New-Item -Path ($protocol + '\shell\open\command') -Force
$powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
Set-Item -Path $command.PSPath -Value ('"' + $powershell + '" -NoProfile -ExecutionPolicy Bypass -File "' + $launcher + '" "%1"')
Write-Host "$Program links installed for this Windows user."
