#Requires -Version 5.1

[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
$Installer = Join-Path $RepoRoot "Install-PowerBI-OpenCodeAccelerator.ps1"
$FixtureRoot = Join-Path $PSScriptRoot "fixtures"
$SkillsSource = Join-Path $FixtureRoot "skills-source"
$TempRoot = Join-Path ([IO.Path]::GetTempPath()) ("PowerBI Accelerator Tests " + [Guid]::NewGuid().ToString("N"))
$InstallRoot = Join-Path $TempRoot "Install Root With Spaces"
$ProjectRoot = Join-Path $TempRoot "Original Project With Spaces"
$CopyRoot = Join-Path $TempRoot "Prepared Copy With Spaces"
$passed = 0

function Assert-True([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw "ASSERTION FAILED: $Message" }
    $script:passed++
}

function Assert-Equal($Expected, $Actual, [string]$Message) {
    if ($Expected -ne $Actual) { throw "ASSERTION FAILED: $Message. Expected '$Expected', actual '$Actual'." }
    $script:passed++
}

function Write-TestFile([string]$Path, [string]$Content) {
    $parent = Split-Path -Parent $Path
    if (-not (Test-Path -LiteralPath $parent -PathType Container)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
    [IO.File]::WriteAllText($Path, $Content, (New-Object Text.UTF8Encoding($false)))
}

function Assert-Parses([string]$Path) {
    $tokens = $null
    $parseErrors = $null
    [void][Management.Automation.Language.Parser]::ParseFile($Path, [ref]$tokens, [ref]$parseErrors)
    Assert-Equal 0 $parseErrors.Count "PowerShell syntax: $Path"
}

function Get-TreeHash([string]$Root) {
    $lines = @()
    foreach ($file in @(Get-ChildItem -LiteralPath $Root -File -Recurse -Force | Sort-Object FullName)) {
        $relative = $file.FullName.Substring($Root.TrimEnd('\').Length + 1)
        $lines += "$relative=$((Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash)"
    }
    $text = $lines -join "`n"
    $bytes = [Text.Encoding]::UTF8.GetBytes($text)
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace("-", "") }
    finally { $sha.Dispose() }
}

try {
    New-Item -ItemType Directory -Path $TempRoot -Force | Out-Null

    Write-Host "[1/8] Parsing all repository PowerShell files"
    foreach ($script in @(Get-ChildItem -LiteralPath $RepoRoot -Filter "*.ps1" -File -Recurse)) { Assert-Parses $script.FullName }

    Write-Host "[2/8] Clean offline install in a path with spaces"
    & $Installer -InstallRoot $InstallRoot -SkillsSourcePath $SkillsSource -SkipNpmInstall -TestOnlyAllowUnverifiedSkillsSource -TestOnlySkipPrerequisiteChecks
    Assert-True (Test-Path -LiteralPath (Join-Path $InstallRoot "managed-inventory.json") -PathType Leaf) "inventory created"
    Assert-True (Test-Path -LiteralPath (Join-Path $InstallRoot "skills\powerbi-report-cli\references\nested\more.md") -PathType Leaf) "whole Microsoft skill copied"
    Assert-True (Test-Path -LiteralPath (Join-Path $InstallRoot "skills\rode-o-bpa\SKILL.md") -PathType Leaf) "rode-o-bpa installed"
    Assert-True (Test-Path -LiteralPath (Join-Path $InstallRoot "skills\check-updates\SKILL.md") -PathType Leaf) "check-updates installed"
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $InstallRoot "skills\fabric-skills"))) "fabric-skills not installed"

    $inventoryPath = Join-Path $InstallRoot "managed-inventory.json"
    $inventoryText = Get-Content -LiteralPath $inventoryPath -Raw
    $collisionRelative = "bin\Test-PowerBI-OpenCodeAccelerator.ps1"
    $collisionInventory = $inventoryText | ConvertFrom-Json
    $collisionInventory.managedFiles = @($collisionInventory.managedFiles | Where-Object { $_ -ne $collisionRelative })
    Write-TestFile $inventoryPath ($collisionInventory | ConvertTo-Json -Depth 8)
    $failed = $false
    try { & $Installer -InstallRoot $InstallRoot -SkillsSourcePath $SkillsSource -SkipNpmInstall -TestOnlyAllowUnverifiedSkillsSource -TestOnlySkipPrerequisiteChecks }
    catch { $failed = $true }
    Assert-True $failed "unmanaged payload collision is refused without Force"
    Write-TestFile $inventoryPath $inventoryText

    $outsideRoot = Join-Path $TempRoot "Outside Managed Root"
    New-Item -ItemType Directory -Path $outsideRoot -Force | Out-Null
    Write-TestFile (Join-Path $outsideRoot "victim.txt") "outside"
    $escapeLink = Join-Path $InstallRoot "escape"
    New-Item -ItemType Junction -Path $escapeLink -Target $outsideRoot | Out-Null
    $junctionInventory = $inventoryText | ConvertFrom-Json
    $junctionInventory.managedFiles = @($junctionInventory.managedFiles) + "escape\victim.txt"
    Write-TestFile $inventoryPath ($junctionInventory | ConvertTo-Json -Depth 8)
    $failed = $false
    try { & $Installer -InstallRoot $InstallRoot -SkillsSourcePath $SkillsSource -SkipNpmInstall -TestOnlyAllowUnverifiedSkillsSource -TestOnlySkipPrerequisiteChecks }
    catch { $failed = $true }
    Assert-True $failed "managed inventory cannot traverse a junction"
    Assert-Equal "outside" (Get-Content -LiteralPath (Join-Path $outsideRoot "victim.txt") -Raw) "junction target remains untouched"
    [IO.Directory]::Delete($escapeLink)
    Write-TestFile $inventoryPath $inventoryText

    Write-Host "[3/8] Reinstall preserves custom paths and cleans obsolete managed paths"
    Write-TestFile (Join-Path $InstallRoot "skills\my-custom-skill\SKILL.md") "---`nname: my-custom-skill`ndescription: custom`n---`n"
    Write-TestFile (Join-Path $InstallRoot "unmanaged.txt") "keep me"
    Write-TestFile (Join-Path $InstallRoot "skills\powerbi-report-cli\obsolete.md") "old managed file"
    $inventory = Get-Content -LiteralPath $inventoryPath -Raw | ConvertFrom-Json
    $inventory.managedFiles = @($inventory.managedFiles) + "skills\powerbi-report-cli\obsolete.md"
    Write-TestFile $inventoryPath ($inventory | ConvertTo-Json -Depth 8)
    foreach ($legacy in @("powerbi-report-authoring", "powerbi-report-design", "powerbi-report-management", "powerbi-report-planning")) {
        Write-TestFile (Join-Path $InstallRoot "skills\$legacy\SKILL.md") "legacy"
    }
    Write-TestFile (Join-Path $InstallRoot "vendor\skills-for-fabric\old.txt") "legacy clone"
    & $Installer -InstallRoot $InstallRoot -SkillsSourcePath $SkillsSource -SkipNpmInstall -TestOnlyAllowUnverifiedSkillsSource -TestOnlySkipPrerequisiteChecks
    Assert-True (Test-Path -LiteralPath (Join-Path $InstallRoot "skills\my-custom-skill\SKILL.md")) "custom skill preserved"
    Assert-Equal "keep me" (Get-Content -LiteralPath (Join-Path $InstallRoot "unmanaged.txt") -Raw) "unmanaged file preserved"
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $InstallRoot "skills\powerbi-report-cli\obsolete.md"))) "obsolete inventory file removed"
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $InstallRoot "skills\powerbi-report-planning"))) "legacy report skill removed"
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $InstallRoot "vendor\skills-for-fabric"))) "legacy vendor clone removed"

    Write-Host "[4/8] Source/download and apply failures retain the installed state"
    $inventoryHash = (Get-FileHash -LiteralPath $inventoryPath -Algorithm SHA256).Hash
    $failed = $false
    try { & $Installer -InstallRoot $InstallRoot -SkillsSourcePath (Join-Path $FixtureRoot "missing-source") -SkipNpmInstall -TestOnlySkipPrerequisiteChecks }
    catch { $failed = $true }
    Assert-True $failed "invalid source fails"
    Assert-Equal $inventoryHash (Get-FileHash -LiteralPath $inventoryPath -Algorithm SHA256).Hash "source failure leaves inventory untouched"

    $failed = $false
    $missingRepo = "file:///" + ((Join-Path $FixtureRoot "missing-repository.git").Replace('\', '/'))
    try { & $Installer -InstallRoot $InstallRoot -RepositoryUrl $missingRepo -SkipNpmInstall -TestOnlySkipPrerequisiteChecks }
    catch { $failed = $true }
    Assert-True $failed "download failure fails"
    Assert-Equal $inventoryHash (Get-FileHash -LiteralPath $inventoryPath -Algorithm SHA256).Hash "download failure leaves inventory untouched"

    $failed = $false
    try { & $Installer -InstallRoot $InstallRoot -SkillsSourcePath $SkillsSource -SkipNpmInstall -TestOnlyAllowUnverifiedSkillsSource -TestOnlySkipPrerequisiteChecks -TestOnlyFailAfterApplyCount 3 }
    catch { $failed = $true }
    Assert-True $failed "injected apply failure fails"
    Assert-Equal $inventoryHash (Get-FileHash -LiteralPath $inventoryPath -Algorithm SHA256).Hash "apply rollback restores inventory"
    Assert-Equal "keep me" (Get-Content -LiteralPath (Join-Path $InstallRoot "unmanaged.txt") -Raw) "apply rollback preserves unmanaged file"
    & (Join-Path $InstallRoot "Restore-PowerBI-OpenCodeAccelerator.ps1") -InstallRoot $InstallRoot
    Assert-Equal $inventoryHash (Get-FileHash -LiteralPath $inventoryPath -Algorithm SHA256).Hash "manifest restore returns previous inventory"
    Assert-Equal "keep me" (Get-Content -LiteralPath (Join-Path $InstallRoot "unmanaged.txt") -Raw) "manifest restore preserves unrelated files"

    Write-Host "[5/8] Launcher preserves project files and generates parseable shortcuts"
    New-Item -ItemType Directory -Path $ProjectRoot -Force | Out-Null
    foreach ($item in @(Get-ChildItem -LiteralPath (Join-Path $FixtureRoot "project") -Force)) {
        Copy-Item -LiteralPath $item.FullName -Destination $ProjectRoot -Recurse -Force
    }
    Write-TestFile (Join-Path $ProjectRoot "AGENTS.md") "custom agents"
    Write-TestFile (Join-Path $ProjectRoot "opencode.jsonc") "{`n  // preserve this comment`n  `"model`": `"fixture/model`"`n}"
    Write-TestFile (Join-Path $ProjectRoot ".opencode\skills\local\SKILL.md") "local skill"
    Write-TestFile (Join-Path $ProjectRoot ".opencode\common\local.md") "local common"
    $starter = Join-Path $InstallRoot "bin\Start-PowerBI-OpenCode.ps1"
    $failed = $false
    try { & $starter -ProjectPath $ProjectRoot -InstallRoot $InstallRoot -InitializeOnly }
    catch { $failed = $true }
    Assert-True $failed "non-junction project skills require Force"
    Assert-True (Test-Path -LiteralPath (Join-Path $ProjectRoot ".opencode\skills\local\SKILL.md")) "local skills untouched after refusal"
    & $starter -ProjectPath $ProjectRoot -InstallRoot $InstallRoot -InitializeOnly -Force
    Assert-Equal "custom agents" (Get-Content -LiteralPath (Join-Path $ProjectRoot "AGENTS.md") -Raw) "AGENTS.md preserved"
    Assert-True ((Get-Content -LiteralPath (Join-Path $ProjectRoot "opencode.jsonc") -Raw) -match "preserve this comment") "opencode.jsonc comments preserved"
    Assert-True (@(Get-ChildItem -LiteralPath (Join-Path $ProjectRoot ".opencode") -Directory | Where-Object { $_.Name -like "skills.backup-*" }).Count -eq 1) "local skills moved to timestamped backup"
    Assert-True (@(Get-ChildItem -LiteralPath (Join-Path $ProjectRoot ".opencode") -Directory | Where-Object { $_.Name -like "common.backup-*" }).Count -eq 1) "local common moved to timestamped backup"
    Assert-Parses (Join-Path $ProjectRoot "Abrir-PowerBI-OpenCode.ps1")

    $projectSkills = Join-Path $ProjectRoot ".opencode\skills"
    [IO.Directory]::Delete($projectSkills)
    $otherSkills = Join-Path $TempRoot "Other Shared Skills"
    New-Item -ItemType Directory -Path $otherSkills -Force | Out-Null
    New-Item -ItemType Junction -Path $projectSkills -Target $otherSkills | Out-Null
    $failed = $false
    try { & $starter -ProjectPath $ProjectRoot -InstallRoot $InstallRoot -InitializeOnly }
    catch { $failed = $true }
    Assert-True $failed "junction to another target is refused without Force"
    Assert-Equal ([IO.Path]::GetFullPath($otherSkills).TrimEnd('\')) ([IO.Path]::GetFullPath([string](Get-Item -LiteralPath $projectSkills -Force).Target).TrimEnd('\')) "foreign junction target preserved"
    & $starter -ProjectPath $ProjectRoot -InstallRoot $InstallRoot -InitializeOnly -Force

    Write-Host "[6/8] Modeling MCP is opt-in and uses a standalone temporary config"
    $localBin = Join-Path $InstallRoot "node\node_modules\.bin"
    Write-TestFile (Join-Path $localBin "powerbi-modeling-mcp.cmd") "@echo off`r`nexit /b 0`r`n"
    $capture = Join-Path $TempRoot "captured-opencode-config.json"
    $oldPath = $env:PATH
    $oldOpenCodeConfig = [Environment]::GetEnvironmentVariable("OPENCODE_CONFIG", "Process")
    $env:PATH = "$FixtureRoot;$oldPath"
    $env:OPENCODE_CAPTURE = $capture
    Remove-Item Env:OPENCODE_CONFIG -ErrorAction SilentlyContinue
    try {
        & $starter -ProjectPath $ProjectRoot -InstallRoot $InstallRoot -EnableModelingMcp
        $mcpConfig = Get-Content -LiteralPath $capture -Raw | ConvertFrom-Json
        Assert-Equal "https://opencode.ai/config.json" $mcpConfig.'$schema' "MCP config schema"
        Assert-Equal "local" $mcpConfig.mcp.'powerbi-modeling-mcp-accelerator'.type "MCP config local type"
        Assert-Equal "1.0.0" ((Get-Content -LiteralPath (Join-Path $InstallRoot "node\package.json") -Raw | ConvertFrom-Json).dependencies.'@microsoft/powerbi-modeling-mcp') "MCP package pin"
        Assert-Equal (Join-Path $localBin "powerbi-modeling-mcp.cmd") $mcpConfig.mcp.'powerbi-modeling-mcp-accelerator'.command[0] "MCP local command path"
        Assert-Equal "--start" $mcpConfig.mcp.'powerbi-modeling-mcp-accelerator'.command[1] "MCP start argument"
        Assert-Equal 30000 $mcpConfig.mcp.'powerbi-modeling-mcp-accelerator'.timeout "MCP timeout"
        Assert-True ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable("OPENCODE_CONFIG", "Process"))) "OPENCODE_CONFIG cleaned after invocation"
        $projectHash = Get-TreeHash $ProjectRoot
        $env:OPENCODE_CONFIG = Join-Path $TempRoot "existing-opencode.json"
        $failed = $false
        try { & $starter -ProjectPath $ProjectRoot -InstallRoot $InstallRoot -EnableModelingMcp }
        catch { $failed = $true }
        Assert-True $failed "existing OPENCODE_CONFIG is rejected"
        Assert-Equal $projectHash (Get-TreeHash $ProjectRoot) "OPENCODE_CONFIG conflict fails before project changes"
        Assert-Equal (Join-Path $TempRoot "existing-opencode.json") $env:OPENCODE_CONFIG "existing OPENCODE_CONFIG preserved"
        Remove-Item Env:OPENCODE_CONFIG -ErrorAction SilentlyContinue
    }
    finally {
        $env:PATH = $oldPath
        Remove-Item Env:OPENCODE_CAPTURE -ErrorAction SilentlyContinue
        Remove-Item Env:OPENCODE_CONFIG -ErrorAction SilentlyContinue
        if (-not [string]::IsNullOrWhiteSpace($oldOpenCodeConfig)) { $env:OPENCODE_CONFIG = $oldOpenCodeConfig }
    }

    Write-Host "[7/8] Smoke diagnostics are read-only and bridge attempts are finite"
    $smoke = Join-Path $InstallRoot "bin\Test-PowerBI-OpenCodeAccelerator.ps1"
    $beforeSmoke = Get-TreeHash $ProjectRoot
    $output = (& $smoke -InstallRoot $InstallRoot -ProjectPath $ProjectRoot 6>&1 | Out-String)
    Assert-Equal $beforeSmoke (Get-TreeHash $ProjectRoot) "default smoke does not modify project"
    Assert-True ($output -match "arquivo validado") "smoke reports file validation"
    Assert-True ($output -match "bridge unavailable") "smoke reports bridge status"
    Assert-True ($output -match "validacao visual not executed") "smoke reports visual validation status"
    $watch = [Diagnostics.Stopwatch]::StartNew()
    $bridgeOutput = (& $smoke -InstallRoot $InstallRoot -ProjectPath $ProjectRoot -TestBridge -BridgeCommand (Join-Path $FixtureRoot "bridge-timeout.cmd") -BridgeTimeoutSeconds 1 -BridgeAttempts 2 6>&1 | Out-String)
    $watch.Stop()
    Assert-True ($bridgeOutput -match "bridge unavailable: timeout") "bridge timeout is diagnostic, not fatal"
    Assert-True ($watch.Elapsed.TotalSeconds -lt 7) "bridge attempts are finite"
    $notConnectedOutput = (& $smoke -InstallRoot $InstallRoot -ProjectPath $ProjectRoot -TestBridge -BridgeCommand (Join-Path $FixtureRoot "bridge-not-connected.cmd") -BridgeTimeoutSeconds 1 -BridgeAttempts 1 6>&1 | Out-String)
    Assert-True ($notConnectedOutput -match "bridge unavailable:.*not_connected") "zero exit with not_connected payload is not reported as connected"

    Write-Host "[8/8] PrepareCopy scaffolds only a new copy"
    $copySource = Join-Path $TempRoot "Copy Source"
    New-Item -ItemType Directory -Path $copySource -Force | Out-Null
    foreach ($item in @(Get-ChildItem -LiteralPath (Join-Path $FixtureRoot "project") -Force)) {
        Copy-Item -LiteralPath $item.FullName -Destination $copySource -Recurse -Force
    }
    $originalHash = Get-TreeHash $copySource
    & $smoke -InstallRoot $InstallRoot -ProjectPath $copySource -PrepareCopy -CopyDestination $CopyRoot
    Assert-Equal $originalHash (Get-TreeHash $copySource) "PrepareCopy leaves original byte-for-byte unchanged"
    Assert-True (Test-Path -LiteralPath (Join-Path $CopyRoot ".opencode\skills")) "copy scaffolded with skills"
    Assert-Parses (Join-Path $CopyRoot "Abrir-PowerBI-OpenCode.ps1")
    Assert-Equal (Get-FileHash -LiteralPath (Join-Path $copySource "Sample.SemanticModel\definition\model.tmdl") -Algorithm SHA256).Hash (Get-FileHash -LiteralPath (Join-Path $CopyRoot "Sample.SemanticModel\definition\model.tmdl") -Algorithm SHA256).Hash "TMDL unchanged in copy"

    Write-Host "PASS: $passed assertions" -ForegroundColor Green
}
finally {
    if (Test-Path -LiteralPath $TempRoot) { Remove-Item -LiteralPath $TempRoot -Recurse -Force -ErrorAction SilentlyContinue }
}
