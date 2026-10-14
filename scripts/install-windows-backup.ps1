$ErrorActionPreference = 'Stop'

$stateDir = Join-Path $env:LOCALAPPDATA 'WikiHMRU'
$defaultOutput = Join-Path $stateDir 'backups'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()

if (-not (Test-Path -LiteralPath $stateDir)) {
    New-Item -ItemType Directory -Path $stateDir | Out-Null
}
$acl = Get-Acl -LiteralPath $stateDir
$acl.SetAccessRuleProtection($true, $false)
foreach ($existingRule in @($acl.Access)) {
    $acl.RemoveAccessRuleSpecific($existingRule)
}
$rule = [System.Security.AccessControl.FileSystemAccessRule]::new(
    $identity.User,
    [System.Security.AccessControl.FileSystemRights]::FullControl,
    [System.Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit',
    [System.Security.AccessControl.PropagationFlags]::None,
    [System.Security.AccessControl.AccessControlType]::Allow
)
$acl.AddAccessRule($rule)
Set-Acl -LiteralPath $stateDir -AclObject $acl

$url = (Read-Host 'Supabase Project URL (https://...supabase.co)').Trim().TrimEnd('/')
if ($url -notmatch '^https://[a-z0-9-]+\.supabase\.co$') {
    throw 'Expected a Supabase HTTPS project URL ending in .supabase.co.'
}
$key = Read-Host 'Supabase service_role key (input is hidden)' -AsSecureString
if ($key.Length -eq 0) { throw 'The service_role key cannot be empty.' }
$output = $defaultOutput

$python = $null
foreach ($candidate in @('py.exe', 'python.exe')) {
    if (-not (Get-Command $candidate -ErrorAction SilentlyContinue)) { continue }
    $args = if ($candidate -eq 'py.exe') { @('-3', '-c', 'import sys; print(sys.executable)') }
            else { @('-c', 'import sys; print(sys.executable)') }
    $resolved = & $candidate @args 2>$null
    if ($LASTEXITCODE -eq 0 -and $resolved -and (Test-Path -LiteralPath $resolved)) {
        $candidatePath = $resolved.Trim()
        $candidateVersion = & $candidatePath -c 'import sys; print("%d.%d" % sys.version_info[:2])'
        if ($LASTEXITCODE -eq 0 -and [version]$candidateVersion -ge [version]'3.11') {
            $python = $candidatePath
            break
        }
    }
}
if (-not $python) { throw 'Install Python 3.11 or newer from python.org and rerun this script.' }

$config = @{
    supabase_url = $url
    encrypted_service_role_key = ConvertFrom-SecureString $key
    output_dir = $output
    python_path = $python
}
$configPath = Join-Path $stateDir 'backup-config.json'
$config | ConvertTo-Json | Set-Content -LiteralPath $configPath -Encoding UTF8

$service = New-Object -ComObject 'Schedule.Service'
$service.Connect()
$folder = $service.GetFolder('\')
$task = $service.NewTask(0)
$task.RegistrationInfo.Description = 'Monthly WikiHMRU Storage image backup; catches up at sign-in.'
$task.Principal.UserId = $identity.Name
$task.Principal.LogonType = 3  # Interactive token: runs under this Windows user after sign-in.
$task.Principal.RunLevel = 0
$task.Settings.Enabled = $true
$task.Settings.StartWhenAvailable = $true
$task.Settings.DisallowStartIfOnBatteries = $false
$task.Settings.StopIfGoingOnBatteries = $false
$task.Settings.MultipleInstances = 2  # Ignore a second trigger while a backup runs.
$task.Settings.ExecutionTimeLimit = 'PT4H'
$daily = $task.Triggers.Create(2)
$daily.StartBoundary = (Get-Date -Hour 10 -Minute 0 -Second 0).ToString('yyyy-MM-ddTHH:mm:ss')
$daily.DaysInterval = 1
$daily.Enabled = $true
$signIn = $task.Triggers.Create(9)
$signIn.UserId = $identity.Name
$signIn.Enabled = $true
$action = $task.Actions.Create(0)
$action.Path = (Get-Process -Id $PID).Path
$action.Arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + (Join-Path $PSScriptRoot 'windows-monthly-backup.ps1') + '"'
$folder.RegisterTaskDefinition('WikiHMRU-Monthly-Photos', $task, 6, $null, $null, 3) | Out-Null

Write-Host 'Scheduled task WikiHMRU-Monthly-Photos installed.'
Write-Host "Images will be saved in $output once a month after sign-in or while the PC is running."
Write-Host "Check results in $stateDir\backup.log"
