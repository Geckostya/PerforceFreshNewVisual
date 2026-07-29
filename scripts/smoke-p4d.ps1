param(
    [Parameter(Mandatory = $true)]
    [string]$ServerRoot
)

$ErrorActionPreference = "Stop"
$resolvedServerRoot = (Resolve-Path -LiteralPath $ServerRoot).Path
$p4 = Join-Path $resolvedServerRoot "bin\p4.exe"
$p4d = Join-Path $resolvedServerRoot "bin\p4d.exe"
$startServer = Join-Path $resolvedServerRoot "start-server.ps1"
$stopServer = Join-Path $resolvedServerRoot "stop-server.ps1"
$ticketFile = Join-Path $resolvedServerRoot "config\.p4tickets"
$pidFile = Join-Path $resolvedServerRoot "run\p4d.pid"

foreach ($requiredPath in @($p4, $p4d, $startServer, $stopServer, $ticketFile)) {
    if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
        throw "P4D test server is missing required file: $requiredPath"
    }
}

$serverWasRunning = $false
if (Test-Path -LiteralPath $pidFile -PathType Leaf) {
    $existingPid = [int](Get-Content -Raw -LiteralPath $pidFile)
    $existingProcess = Get-Process -Id $existingPid -ErrorAction SilentlyContinue
    if ($null -ne $existingProcess -and $existingProcess.Path -ne $p4d) {
        throw "PID $existingPid does not belong to the configured disposable P4D server."
    }
    $serverWasRunning = $null -ne $existingProcess
}

$startedHere = -not $serverWasRunning
$createdChange = $null
$env:P4PORT = "localhost:1666"
$env:P4USER = "p4fnv_test"
$env:P4CLIENT = "p4fnv_test_ws"
$env:P4CHARSET = "utf8"
$env:P4TICKETS = $ticketFile

try {
    if ($startedHere) {
        & $startServer
    }

    $connected = $false
    for ($attempt = 0; $attempt -lt 20; $attempt += 1) {
        & $p4 login -s *> $null
        if ($LASTEXITCODE -eq 0) {
            $connected = $true
            break
        }
        Start-Sleep -Milliseconds 250
    }
    if (-not $connected) {
        throw "Disposable P4D server did not become ready or its test ticket is invalid."
    }

    $template = (& $p4 change -o | Out-String)
    if ($LASTEXITCODE -ne 0 -or -not $template.Contains("<enter description here>")) {
        throw "Could not obtain a new changelist form from the disposable P4D server."
    }

    $description = "P4FNV validator write smoke $([guid]::NewGuid().ToString('N'))"
    $form = $template.Replace("<enter description here>", $description)
    $createOutput = ($form | & $p4 change -i | Out-String)
    if ($LASTEXITCODE -ne 0 -or $createOutput -notmatch "Change\s+(\d+)\s+created") {
        throw "Could not create a disposable changelist: $createOutput"
    }
    $createdChange = $Matches[1]

    & $p4 change -o $createdChange *> $null
    if ($LASTEXITCODE -ne 0) {
        throw "Created changelist $createdChange could not be read back."
    }

    & $p4 change -d $createdChange *> $null
    if ($LASTEXITCODE -ne 0) {
        throw "Could not delete disposable changelist $createdChange."
    }
    $createdChange = $null
    Write-Host "Writable P4D smoke passed on localhost:1666."
}
finally {
    if ($null -ne $createdChange) {
        & $p4 change -d $createdChange *> $null
    }
    if ($startedHere) {
        & $stopServer
    }
}
