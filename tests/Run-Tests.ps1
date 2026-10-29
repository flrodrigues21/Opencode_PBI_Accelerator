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
$DemoCopyRoot = Join-Path $TempRoot "Independent Demo With Spaces"
$CommandSource = Join-Path $RepoRoot ".opencode\commands\demo-powerbi.md"
$PrivatePathPattern = '(?i)(?:[A-Z]:(?:\\{1,2}|/)Users(?:\\{1,2}|/)|file:(?:/{2,4}|\\{2,4})[A-Z]:(?:\\{1,2}|/)Users(?:\\{1,2}|/))'
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

    Write-Host "[1/10] Parsing scripts and the repository command"
    foreach ($script in @(Get-ChildItem -LiteralPath $RepoRoot -Filter "*.ps1" -File -Recurse)) { Assert-Parses $script.FullName }
    Assert-True (Test-Path -LiteralPath $CommandSource -PathType Leaf) "repository exposes /demo-powerbi"
    $commandText = Get-Content -LiteralPath $CommandSource -Raw
    Assert-True ($commandText -match '(?s)^---\s*\r?\n.*?description:\s*\S.+?\r?\n---\s*\r?\n\S') "demo command has official frontmatter and prompt body"
    Assert-True ($commandText -match '\$ARGUMENTS') "demo command accepts destination arguments"
    Assert-True ($commandText -match 'examples[/\\]VendasDemo') "demo command references canonical example"
    Assert-True ($commandText -match 'VendasDemo-Demo') "demo command defines a safe default destination"
    Assert-True ($commandText -notmatch [regex]::Escape('C:\OpenCode\PowerBI-Accelerator')) "demo command does not hardcode install root"

    Write-Host "[2/10] Desktop adapter unit tests"
    & node --test (Join-Path $PSScriptRoot "powerbi-desktop-safe.test.mjs")
    Assert-Equal 0 $LASTEXITCODE "desktop adapter unit tests"

    Write-Host "[3/10] Clean offline install in a path with spaces"
    & $Installer -InstallRoot $InstallRoot -SkillsSourcePath $SkillsSource -SkipNpmInstall -TestOnlyAllowUnverifiedSkillsSource -TestOnlySkipPrerequisiteChecks
    Assert-True (Test-Path -LiteralPath (Join-Path $InstallRoot "managed-inventory.json") -PathType Leaf) "inventory created"
    Assert-True (Test-Path -LiteralPath (Join-Path $InstallRoot "skills\powerbi-report-cli\references\nested\more.md") -PathType Leaf) "whole Microsoft skill copied"
    Assert-True (Test-Path -LiteralPath (Join-Path $InstallRoot "skills\rode-o-bpa\SKILL.md") -PathType Leaf) "rode-o-bpa installed"
    Assert-True (Test-Path -LiteralPath (Join-Path $InstallRoot "skills\check-updates\SKILL.md") -PathType Leaf) "check-updates installed"
    Assert-True (Test-Path -LiteralPath (Join-Path $InstallRoot "skills\powerbi-desktop-safe\SKILL.md") -PathType Leaf) "powerbi-desktop-safe installed"
    Assert-True (Test-Path -LiteralPath (Join-Path $InstallRoot "bin\powerbi-desktop-safe.mjs") -PathType Leaf) "desktop adapter installed"
    Assert-True (Test-Path -LiteralPath (Join-Path $InstallRoot "bin\bridge-status-worker.mjs") -PathType Leaf) "bounded status worker installed"
    Assert-True (Test-Path -LiteralPath (Join-Path $InstallRoot "lib\powerbi-desktop-safe.mjs") -PathType Leaf) "desktop adapter library installed"
    Assert-True (Test-Path -LiteralPath (Join-Path $InstallRoot "docs\POWERBI-DESKTOP-INTEGRATION.md") -PathType Leaf) "desktop integration documentation installed"
    $installedAdapter = Join-Path $InstallRoot "bin\powerbi-desktop-safe.cmd"
    $adapterState = Join-Path $TempRoot "Adapter State"
    $adapterDestination = Join-Path $TempRoot "Manual Save Destination.pbip"
    $adapterOutput = (& $installedAdapter save-as (Join-Path $RepoRoot "examples\VendasDemo\VendasDemo.pbip") $adapterDestination --state-dir $adapterState 2>&1 | Out-String)
    Assert-Equal 0 $LASTEXITCODE "installed adapter save-as exit code"
    $adapterResult = $adapterOutput | ConvertFrom-Json
    Assert-Equal "UNSUPPORTED_CAPABILITY" $adapterResult.status "installed adapter executes with relative library import"
    Assert-True (Test-Path -LiteralPath $adapterResult.checkpointPath -PathType Leaf) "installed adapter writes checkpoint"
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $InstallRoot "skills\fabric-skills"))) "fabric-skills not installed"
    $installedCommand = Join-Path $InstallRoot "commands\demo-powerbi.md"
    $installedDemo = Join-Path $InstallRoot "examples\VendasDemo"
    Assert-True (Test-Path -LiteralPath $installedCommand -PathType Leaf) "demo command installed"
    Assert-Equal (Get-FileHash -LiteralPath $CommandSource -Algorithm SHA256).Hash (Get-FileHash -LiteralPath $installedCommand -Algorithm SHA256).Hash "installed command matches repository"
    Assert-True (Test-Path -LiteralPath (Join-Path $installedDemo "VendasDemo.pbip") -PathType Leaf) "VendasDemo installed"
    Assert-Equal (Get-TreeHash (Join-Path $RepoRoot "examples\VendasDemo")) (Get-TreeHash $installedDemo) "installed demo matches canonical example"

    $inventoryPath = Join-Path $InstallRoot "managed-inventory.json"
    $inventoryText = Get-Content -LiteralPath $inventoryPath -Raw
    $collisionRelative = "bin\Test-PowerBI-OpenCodeAccelerator.ps1"
    $collisionInventory = $inventoryText | ConvertFrom-Json
    Assert-True (@($collisionInventory.managedFiles) -contains "commands\demo-powerbi.md") "inventory manages demo command"
    Assert-True (@($collisionInventory.managedFiles) -contains "examples\VendasDemo\VendasDemo.pbip") "inventory manages demo files"
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

    Write-Host "[4/10] Reinstall preserves custom paths and cleans obsolete managed paths"
    Write-TestFile (Join-Path $InstallRoot "skills\my-custom-skill\SKILL.md") "---`nname: my-custom-skill`ndescription: custom`n---`n"
    Write-TestFile (Join-Path $InstallRoot "commands\my-custom-command.md") "custom command"
    Write-TestFile (Join-Path $InstallRoot "examples\VendasDemo\custom-note.txt") "custom demo note"
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
    Assert-Equal "custom command" (Get-Content -LiteralPath (Join-Path $InstallRoot "commands\my-custom-command.md") -Raw) "custom installed command preserved"
    Assert-Equal "custom demo note" (Get-Content -LiteralPath (Join-Path $InstallRoot "examples\VendasDemo\custom-note.txt") -Raw) "unmanaged demo sibling preserved"
    Assert-Equal "keep me" (Get-Content -LiteralPath (Join-Path $InstallRoot "unmanaged.txt") -Raw) "unmanaged file preserved"
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $InstallRoot "skills\powerbi-report-cli\obsolete.md"))) "obsolete inventory file removed"
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $InstallRoot "skills\powerbi-report-planning"))) "legacy report skill removed"
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $InstallRoot "vendor\skills-for-fabric"))) "legacy vendor clone removed"

    Write-Host "[5/10] Source/download and apply failures retain the installed state"
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

    Write-Host "[6/10] Launcher preserves project files, commands, and shortcuts"
    New-Item -ItemType Directory -Path $ProjectRoot -Force | Out-Null
    foreach ($item in @(Get-ChildItem -LiteralPath (Join-Path $FixtureRoot "project") -Force)) {
        Copy-Item -LiteralPath $item.FullName -Destination $ProjectRoot -Recurse -Force
    }
    Write-TestFile (Join-Path $ProjectRoot "AGENTS.md") "custom agents"
    Write-TestFile (Join-Path $ProjectRoot "opencode.jsonc") "{`n  // preserve this comment`n  `"model`": `"fixture/model`"`n}"
    Write-TestFile (Join-Path $ProjectRoot ".opencode\skills\local\SKILL.md") "local skill"
    Write-TestFile (Join-Path $ProjectRoot ".opencode\common\local.md") "local common"
    Write-TestFile (Join-Path $ProjectRoot ".opencode\commands\custom.md") "custom project command"
    $starter = Join-Path $InstallRoot "bin\Start-PowerBI-OpenCode.ps1"
    $failed = $false
    try { & $starter -ProjectPath $ProjectRoot -InstallRoot $InstallRoot -InitializeOnly }
    catch { $failed = $true }
    Assert-True $failed "non-junction project skills require Force"
    Assert-True (Test-Path -LiteralPath (Join-Path $ProjectRoot ".opencode\skills\local\SKILL.md")) "local skills untouched after refusal"
    & $starter -ProjectPath $ProjectRoot -InstallRoot $InstallRoot -InitializeOnly -Force
    Assert-Equal "custom agents" (Get-Content -LiteralPath (Join-Path $ProjectRoot "AGENTS.md") -Raw) "AGENTS.md preserved"
    Assert-True ((Get-Content -LiteralPath (Join-Path $ProjectRoot "opencode.jsonc") -Raw) -match "preserve this comment") "opencode.jsonc comments preserved"
    Assert-Equal "custom project command" (Get-Content -LiteralPath (Join-Path $ProjectRoot ".opencode\commands\custom.md") -Raw) "custom project command preserved"
    $projectDemoCommand = Join-Path $ProjectRoot ".opencode\commands\demo-powerbi.md"
    Assert-True (Test-Path -LiteralPath $projectDemoCommand -PathType Leaf) "demo command discovered in prepared project"
    Assert-True (-not ((Get-Item -LiteralPath (Join-Path $ProjectRoot ".opencode\commands") -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) "project commands remain a real directory"
    Assert-True (@(Get-ChildItem -LiteralPath (Join-Path $ProjectRoot ".opencode") -Directory | Where-Object { $_.Name -like "skills.backup-*" }).Count -eq 1) "local skills moved to timestamped backup"
    Assert-True (@(Get-ChildItem -LiteralPath (Join-Path $ProjectRoot ".opencode") -Directory | Where-Object { $_.Name -like "common.backup-*" }).Count -eq 1) "local common moved to timestamped backup"
    Assert-Parses (Join-Path $ProjectRoot "Abrir-PowerBI-OpenCode.ps1")
    Write-TestFile $projectDemoCommand "custom demo command"
    & $starter -ProjectPath $ProjectRoot -InstallRoot $InstallRoot -InitializeOnly -Force
    Assert-Equal "custom demo command" (Get-Content -LiteralPath $projectDemoCommand -Raw) "same-name custom command is never overwritten"

    $junctionProject = Join-Path $TempRoot "Project With Linked OpenCode"
    $externalOpenCode = Join-Path $TempRoot "External OpenCode Target"
    New-Item -ItemType Directory -Path $junctionProject -Force | Out-Null
    New-Item -ItemType Directory -Path $externalOpenCode -Force | Out-Null
    New-Item -ItemType Junction -Path (Join-Path $junctionProject ".opencode") -Target $externalOpenCode | Out-Null
    $failed = $false
    try { & $starter -ProjectPath $junctionProject -InstallRoot $InstallRoot -InitializeOnly -Force }
    catch { $failed = $true }
    Assert-True $failed "launcher refuses a linked .opencode ancestor"
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $externalOpenCode "commands\demo-powerbi.md"))) "launcher does not write command through junction"
    [IO.Directory]::Delete((Join-Path $junctionProject ".opencode"))

    $singularCommandProject = Join-Path $TempRoot "Project With Singular Command"
    Write-TestFile (Join-Path $singularCommandProject ".opencode\command\demo-powerbi.md") "legacy singular command"
    & $starter -ProjectPath $singularCommandProject -InstallRoot $InstallRoot -InitializeOnly -Force
    Assert-Equal "legacy singular command" (Get-Content -LiteralPath (Join-Path $singularCommandProject ".opencode\command\demo-powerbi.md") -Raw) "launcher preserves unrelated singular command"
    Assert-True (Test-Path -LiteralPath (Join-Path $singularCommandProject ".opencode\commands\demo-powerbi.md") -PathType Leaf) "singular command does not suppress discoverable plural command"

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

    Write-Host "[7/10] Modeling MCP is opt-in and uses a standalone temporary config"
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

    Write-Host "[8/10] Smoke diagnostics are read-only and bridge attempts are finite"
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

    Write-Host "[9/10] PrepareCopy scaffolds only a new copy"
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
    Assert-True ((Get-Content -LiteralPath (Join-Path $CopyRoot "AGENTS.md") -Raw) -match "Execucao Backend Primeiro") "new projects receive backend-first instructions"
    Assert-Equal (Get-FileHash -LiteralPath (Join-Path $copySource "Sample.SemanticModel\definition\model.tmdl") -Algorithm SHA256).Hash (Get-FileHash -LiteralPath (Join-Path $CopyRoot "Sample.SemanticModel\definition\model.tmdl") -Algorithm SHA256).Hash "TMDL unchanged in copy"

    Write-Host "[10/10] Demo command flow creates one clean independent copy"
    $reportAuthorFixture = Join-Path $InstallRoot "node\node_modules\.bin\powerbi-report-author.cmd"
    Write-TestFile $reportAuthorFixture "@echo off`r`nif not `"%~1`"==`"validate`" exit /b 11`r`nif not `"%~3`"==`"--no-schema`" exit /b 12`r`nif not exist `"%~2`" exit /b 13`r`necho {`"data`":{`"result`":`"succeeded`"}}`r`n"
    $demoOutput = (& $smoke -InstallRoot $InstallRoot -ProjectPath $ProjectRoot -PrepareDemo -DemoDestination $DemoCopyRoot 6>&1 | Out-String)
    Assert-True ($demoOutput -match '\[OK\] PBIR validado pela CLI') "demo flow uses PBIR CLI when available"
    Assert-True ($demoOutput -match '\[PROXIMO\] PBIP para abrir:') "demo flow reports the PBIP to open"
    Assert-True (Test-Path -LiteralPath (Join-Path $DemoCopyRoot "VendasDemo.pbip") -PathType Leaf) "independent demo created in path with spaces"
    Assert-Equal (Get-TreeHash (Join-Path $RepoRoot "examples\VendasDemo")) (Get-TreeHash $DemoCopyRoot) "independent demo contains only canonical managed files"
    $demoItems = @(Get-ChildItem -LiteralPath $DemoCopyRoot -Recurse -Force)
    Assert-Equal 0 @($demoItems | Where-Object { ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 }).Count "independent demo has no junctions"
    Assert-Equal 0 @($demoItems | Where-Object { $_.PSIsContainer -and $_.Name -in @('.pbi', '.opencode', 'node_modules') }).Count "independent demo has no local directories"
    $privatePaths = @(Get-ChildItem -LiteralPath $DemoCopyRoot -Recurse -Force -File | Where-Object { $_.Extension -in @('.json', '.md', '.pbip', '.pbir', '.pbism', '.ps1', '.tmdl') -or $_.Name -in @('.gitignore', '.platform') } | Where-Object { (Get-Content -LiteralPath $_.FullName -Raw) -match $PrivatePathPattern })
    Assert-Equal 0 $privatePaths.Count "independent demo has no private paths"
    $failed = $false
    try { & $smoke -InstallRoot $InstallRoot -ProjectPath $ProjectRoot -PrepareDemo -DemoDestination $DemoCopyRoot }
    catch { $failed = $true }
    Assert-True $failed "demo flow refuses to overwrite an existing destination"

    $copiedFact = Join-Path $DemoCopyRoot "VendasDemo.SemanticModel\definition\tables\FatoVendas.tmdl"
    $factText = Get-Content -LiteralPath $copiedFact -Raw
    Write-TestFile $copiedFact ($factText.Replace('{1..120}', '{1..1}'))
    $failed = $false
    try { & (Join-Path $DemoCopyRoot "Test-VendasDemo.ps1") }
    catch { $failed = $true }
    Assert-True $failed "totals validation is coupled to the copied TMDL definition"

    $traversalDestination = Join-Path $TempRoot "Traversal Demo"
    $outsideVictim = Join-Path $TempRoot "outside-demo.txt"
    Write-TestFile $outsideVictim "outside remains"
    $inventoryBeforeTraversal = Get-Content -LiteralPath $inventoryPath -Raw
    $traversalInventory = $inventoryBeforeTraversal | ConvertFrom-Json
    $traversalInventory.managedFiles = @($traversalInventory.managedFiles) + "examples\VendasDemo\..\..\outside-demo.txt"
    Write-TestFile $inventoryPath ($traversalInventory | ConvertTo-Json -Depth 8)
    $failed = $false
    try { & $smoke -InstallRoot $InstallRoot -ProjectPath $ProjectRoot -PrepareDemo -DemoDestination $traversalDestination }
    catch { $failed = $true }
    Assert-True $failed "demo flow rejects traversal in managed inventory"
    Assert-Equal "outside remains" (Get-Content -LiteralPath $outsideVictim -Raw) "inventory traversal cannot overwrite an outside file"
    Assert-True (-not (Test-Path -LiteralPath $traversalDestination)) "failed traversal leaves no partial destination"
    Write-TestFile $inventoryPath $inventoryBeforeTraversal

    Remove-Item -LiteralPath $reportAuthorFixture -Force
    $pathCliRoot = Join-Path $TempRoot "PATH CLI With Spaces"
    $pathCli = Join-Path $pathCliRoot "powerbi-report-author.ps1"
    Write-TestFile $pathCli "if (`$args[0] -ne 'validate' -or `$args[2] -ne '--no-schema' -or -not (Test-Path -LiteralPath `$args[1])) { exit 14 }`n'{`"data`":{`"result`":`"succeeded`"}}'`n"
    $pathDemoDestination = Join-Path $TempRoot "PATH Shim Demo"
    $oldPath = $env:PATH
    try {
        $env:PATH = "$pathCliRoot;$oldPath"
        $pathDemoOutput = (& $smoke -InstallRoot $InstallRoot -ProjectPath $ProjectRoot -PrepareDemo -DemoDestination $pathDemoDestination 6>&1 | Out-String)
    }
    finally { $env:PATH = $oldPath }
    Assert-True ($pathDemoOutput -match '\[OK\] PBIR validado pela CLI') "demo flow supports a PowerShell npm shim found on PATH"
    Assert-True (Test-Path -LiteralPath (Join-Path $pathDemoDestination "VendasDemo.pbip") -PathType Leaf) "PowerShell PATH shim flow publishes the validated demo"

    Write-TestFile $reportAuthorFixture "@echo off`r`nif defined DEMO_RACE_DESTINATION (`r`n  mkdir `"%DEMO_RACE_DESTINATION%`"`r`n  echo preserve me>`"%DEMO_RACE_DESTINATION%\sentinel.txt`"`r`n)`r`necho {`"data`":{`"result`":`"succeeded`"}}`r`n"
    $raceDestination = Join-Path $TempRoot "Race Destination"
    $env:DEMO_RACE_DESTINATION = $raceDestination
    $failed = $false
    try { & $smoke -InstallRoot $InstallRoot -ProjectPath $ProjectRoot -PrepareDemo -DemoDestination $raceDestination }
    catch { $failed = $true }
    finally { Remove-Item Env:DEMO_RACE_DESTINATION -ErrorAction SilentlyContinue }
    Assert-True $failed "demo flow detects a destination created during validation"
    Assert-Equal "preserve me`r`n" (Get-Content -LiteralPath (Join-Path $raceDestination "sentinel.txt") -Raw) "race destination contents are never deleted"
    Assert-Equal 0 @(Get-ChildItem -LiteralPath $TempRoot -Directory -Force | Where-Object { $_.Name -like '.VendasDemo-stage-*' }).Count "failed publication removes only its private staging directory"

    $installedDemoReadme = Join-Path $InstallRoot "examples\VendasDemo\README.md"
    $installedDemoReadmeOriginal = Get-Content -LiteralPath $installedDemoReadme -Raw
    $escapedPrivateDestination = Join-Path $TempRoot "Escaped Private Path Demo"
    Write-TestFile $installedDemoReadme ($installedDemoReadmeOriginal + "`nC:\\Users\\private\\report.pbip")
    $failed = $false
    try { & $smoke -InstallRoot $InstallRoot -ProjectPath $ProjectRoot -PrepareDemo -DemoDestination $escapedPrivateDestination }
    catch { $failed = $true }
    Assert-True $failed "demo flow rejects JSON-escaped Windows private paths"
    Assert-True (-not (Test-Path -LiteralPath $escapedPrivateDestination)) "escaped private path creates no destination"

    $slashPrivateDestination = Join-Path $TempRoot "Slash Private Path Demo"
    Write-TestFile $installedDemoReadme ($installedDemoReadmeOriginal + "`nC:/Users/private/report.pbip")
    $failed = $false
    try { & $smoke -InstallRoot $InstallRoot -ProjectPath $ProjectRoot -PrepareDemo -DemoDestination $slashPrivateDestination }
    catch { $failed = $true }
    Assert-True $failed "demo flow rejects slash-form Windows private paths"
    Assert-True (-not (Test-Path -LiteralPath $slashPrivateDestination)) "slash private path creates no destination"
    Write-TestFile $installedDemoReadme $installedDemoReadmeOriginal

    Write-Host "PASS: $passed assertions" -ForegroundColor Green
}
finally {
    if (Test-Path -LiteralPath $TempRoot) { Remove-Item -LiteralPath $TempRoot -Recurse -Force -ErrorAction SilentlyContinue }
}
