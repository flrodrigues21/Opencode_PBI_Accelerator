#Requires -Version 5.1

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ProjectPath,
    [string]$AdapterPath = (Join-Path (Split-Path -Parent $PSScriptRoot) "bin\powerbi-desktop-safe.mjs")
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$ProjectPath = [IO.Path]::GetFullPath($ProjectPath)
$AdapterPath = [IO.Path]::GetFullPath($AdapterPath)
$pbipFiles = @(Get-ChildItem -LiteralPath $ProjectPath -Filter "*.pbip" -File -ErrorAction Stop)
if ($pbipFiles.Count -ne 1) { throw "Expected exactly one disposable PBIP in '$ProjectPath'; found $($pbipFiles.Count)." }
$pbip = $pbipFiles[0]
if (-not (Test-Path -LiteralPath $AdapterPath -PathType Leaf)) { throw "Adapter not found: $AdapterPath" }

$existingDesktop = @(Get-Process -Name PBIDesktop -ErrorAction SilentlyContinue)
if ($existingDesktop.Count -gt 0) {
    throw "Safety stop: $($existingDesktop.Count) PBIDesktop process(es) already exist. Close them manually before this disposable test. PIDs: $($existingDesktop.Id -join ', ')"
}

$stateDir = Join-Path $ProjectPath ".adapter-validation\state"
$outputDir = Join-Path $ProjectPath ".adapter-validation\screenshots"

function Invoke-AdapterJson([string[]]$Arguments) {
    $text = (& node $AdapterPath @Arguments 2>&1 | Out-String).Trim()
    $exitCode = $LASTEXITCODE
    if ([string]::IsNullOrWhiteSpace($text)) { throw "Adapter returned no JSON. Exit code: $exitCode" }
    try { $result = $text | ConvertFrom-Json }
    catch { throw "Adapter returned invalid JSON (exit $exitCode): $text" }
    if ($exitCode -ne 0) { throw "Adapter command failed (exit $exitCode): $text" }
    return $result
}

Write-Host "[ETAPA 1/5] Opening the disposable PBIP exactly once"
$open = Invoke-AdapterJson @("open", $pbip.FullName, "--wait-seconds", "15", "--state-dir", $stateDir)
if ($open.status -ne "READY" -or $open.bridge.status -ne "CONNECTED") {
    throw "Disposable target did not reach READY: $($open | ConvertTo-Json -Depth 12)"
}
if ($open.engine.status -ne "NOT_EXPOSED" -or $open.mcp.status -ne "NOT_CHECKED") {
    throw "READY incorrectly collapsed engine or MCP state."
}
$desktopPid = [int]$open.desktop.pid

Write-Host "[ETAPA 2/5] Resolving path to the same Desktop PID and Bridge"
$resolved = Invoke-AdapterJson @("resolve", $pbip.FullName, "--pid", [string]$desktopPid, "--state-dir", $stateDir)
if ($resolved.status -ne "READY" -or [int]$resolved.desktop.pid -ne $desktopPid -or
    -not [IO.Path]::GetFullPath([string]$resolved.desktop.currentFilePath).Equals($pbip.FullName, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Path/PID/Bridge identity mismatch: $($resolved | ConvertTo-Json -Depth 12)"
}

Write-Host "[ETAPA 3/5] Reading capabilities once for the explicit PID"
$capabilities = Invoke-AdapterJson @("capabilities", $pbip.FullName, "--pid", [string]$desktopPid, "--state-dir", $stateDir)
if ($capabilities.status -ne "READY" -or -not $capabilities.capabilities.screenshot) {
    throw "Snapshot capability is unavailable: $($capabilities | ConvertTo-Json -Depth 12)"
}

Write-Host "[ETAPA 4/5] Capturing one page and persisting a partial checkpoint"
$firstCapture = Invoke-AdapterJson @(
    "capture-all", $pbip.FullName,
    "--pid", [string]$desktopPid,
    "--output-dir", $outputDir,
    "--total-seconds", "20",
    "--page-seconds", "10",
    "--max-pages", "1",
    "--state-dir", $stateDir
)
if ($firstCapture.status -notin @("PARTIAL_CHECKPOINT", "COMPLETE") -or $firstCapture.progress.completed -lt 1) {
    throw "First-page capture failed: $($firstCapture | ConvertTo-Json -Depth 12)"
}

Write-Host "[ETAPA 5/5] Resuming only pending pages from the checkpoint"
$allCaptures = Invoke-AdapterJson @(
    "capture-all", $pbip.FullName,
    "--pid", [string]$desktopPid,
    "--output-dir", $outputDir,
    "--total-seconds", "20",
    "--page-seconds", "10",
    "--state-dir", $stateDir
)
if ($allCaptures.status -ne "COMPLETE") {
    throw "Incremental capture did not complete: $($allCaptures | ConvertTo-Json -Depth 12)"
}

$afterDesktop = @(Get-Process -Name PBIDesktop -ErrorAction SilentlyContinue)
if ($afterDesktop.Id -notcontains $desktopPid) { throw "Resolved Desktop PID no longer exists: $desktopPid" }
if ($afterDesktop.Count -ne 1 -or [int]$afterDesktop[0].Id -ne $desktopPid) {
    throw "Safety stop before MCP: another PBIDesktop process appeared during validation. Current PIDs: $($afterDesktop.Id -join ', ')"
}

[ordered]@{
    status = "BRIDGE_AND_CAPTURE_VALIDATED"
    projectPath = $ProjectPath
    pbipPath = $pbip.FullName
    desktopPid = $desktopPid
    bridgeStatus = $resolved.bridge.status
    engineStatus = $resolved.engine.status
    mcpStatus = $resolved.mcp.status
    screenshots = @($allCaptures.captures)
    checkpointPath = $allCaptures.checkpointPath
    desktopProcessesAfterLaunch = @($afterDesktop.Id)
    mcpNextStep = "Connect Modeling MCP only after confirming this is the sole disposable Desktop report; record the selected engine/port and verify its model name before any write operation."
} | ConvertTo-Json -Depth 12

Write-Host "The script intentionally leaves the disposable Desktop session open and never saves, reloads, refreshes, or terminates it." -ForegroundColor Yellow
