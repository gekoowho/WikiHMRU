$ErrorActionPreference = 'Stop'

$stateDir = Join-Path $env:LOCALAPPDATA 'WikiHMRU'
$configPath = Join-Path $stateDir 'backup-config.json'
$stampPath = Join-Path $stateDir 'last-backup-month.txt'
$logPath = Join-Path $stateDir 'backup.log'

try {
    if (-not (Test-Path -LiteralPath $configPath)) {
        throw 'Backup is not configured. Run install-windows-backup.ps1 first.'
    }
    $config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
    $month = (Get-Date).ToString('yyyy-MM')
    if ((Test-Path -LiteralPath $stampPath) -and
        (Get-Content -LiteralPath $stampPath -Raw).Trim() -eq $month) {
        exit 0
    }

    $secureKey = ConvertTo-SecureString $config.encrypted_service_role_key
    $keyPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
    $dbPointer = [IntPtr]::Zero
    try {
        $env:SUPABASE_SERVICE_ROLE_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($keyPointer)
        $env:SUPABASE_URL = $config.supabase_url
        $backupArgs = @((Join-Path $PSScriptRoot 'backup.py'), '--output-dir', $config.output_dir)
        if ($config.mode -eq 'full') {
            if (-not $config.encrypted_db_url -or -not $config.pg_dump_path) {
                throw 'Full backup configuration is incomplete. Rerun the installer.'
            }
            $secureDbUrl = ConvertTo-SecureString $config.encrypted_db_url
            $dbPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureDbUrl)
            $env:SUPABASE_DB_URL = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($dbPointer)
            $env:PATH = (Split-Path -Parent $config.pg_dump_path) + ';' + $env:PATH
        }
        else { $backupArgs += '--images-only' }
        "$(Get-Date -Format s) Starting monthly $($config.mode) backup" | Add-Content -LiteralPath $logPath
        & $config.python_path @backupArgs *>> $logPath
        if ($LASTEXITCODE -ne 0) {
            throw "Backup or verification failed with exit code $LASTEXITCODE. See $logPath"
        }
        $month | Set-Content -LiteralPath $stampPath
        "$(Get-Date -Format s) Backup verified; next run is due next month" | Add-Content -LiteralPath $logPath
    }
    finally {
        Remove-Item Env:SUPABASE_SERVICE_ROLE_KEY -ErrorAction SilentlyContinue
        Remove-Item Env:SUPABASE_URL -ErrorAction SilentlyContinue
        Remove-Item Env:SUPABASE_DB_URL -ErrorAction SilentlyContinue
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($keyPointer)
        if ($dbPointer -ne [IntPtr]::Zero) {
            [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($dbPointer)
        }
    }
}
catch {
    "$(Get-Date -Format s) Backup failed: $($_.Exception.Message)" | Add-Content -LiteralPath $logPath
    Write-Error $_.Exception.Message
    exit 1
}
