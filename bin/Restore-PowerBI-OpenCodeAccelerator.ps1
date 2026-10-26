#Requires -Version 5.1

[CmdletBinding()]
param(
    [string]$InstallRoot = "C:\OpenCode\PowerBI-Accelerator",
    [string]$BackupPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$InstallRoot = [IO.Path]::GetFullPath($InstallRoot)
$BackupsRoot = Join-Path $InstallRoot "backups"

function Ensure-Directory([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
        New-Item -ItemType Directory -Path $Path -Force | Out-Null
    }
}

function Resolve-SafeRelativePath([string]$Root, [string]$RelativePath) {
    if ([string]::IsNullOrWhiteSpace($RelativePath) -or [IO.Path]::IsPathRooted($RelativePath)) {
        throw "Caminho relativo invalido no manifesto: '$RelativePath'."
    }
    $prefix = [IO.Path]::GetFullPath($Root).TrimEnd('\') + '\'
    $full = [IO.Path]::GetFullPath((Join-Path $Root $RelativePath))
    if (-not $full.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Caminho escapa da raiz permitida: '$RelativePath'."
    }
    $current = [IO.Path]::GetFullPath($Root).TrimEnd('\')
    foreach ($segment in $RelativePath -split '[\\/]') {
        if ([string]::IsNullOrWhiteSpace($segment)) { continue }
        $current = Join-Path $current $segment
        $item = Get-Item -LiteralPath $current -Force -ErrorAction SilentlyContinue
        if ($null -ne $item -and (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)) {
            throw "Caminho gerenciado contem junction ou link simbolico: '$RelativePath'."
        }
    }
    return $full
}

if (-not (Test-Path -LiteralPath $BackupsRoot -PathType Container)) {
    throw "Nenhum diretorio de backups encontrado em: $BackupsRoot"
}

if ([string]::IsNullOrWhiteSpace($BackupPath)) {
    $candidate = Get-ChildItem -LiteralPath $BackupsRoot -Directory | Where-Object {
        Test-Path -LiteralPath (Join-Path $_.FullName "backup-manifest.json") -PathType Leaf
    } | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
    if ($null -eq $candidate) { throw "Nenhum backup valido encontrado em: $BackupsRoot" }
    $BackupPath = $candidate.FullName
}
else {
    $BackupPath = [IO.Path]::GetFullPath($BackupPath)
}

$backupPrefix = [IO.Path]::GetFullPath($BackupsRoot).TrimEnd('\') + '\'
if (-not ($BackupPath + '\').StartsWith($backupPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "O backup especificado deve estar dentro de: $BackupsRoot"
}
$manifestPath = Join-Path $BackupPath "backup-manifest.json"
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { throw "Manifesto de backup ausente: $manifestPath" }
try { $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json }
catch { throw "Manifesto de backup invalido: $($_.Exception.Message)" }
if ($manifest.schemaVersion -ne 1 -or $manifest.installRoot -ne $InstallRoot) {
    throw "Manifesto nao pertence a esta instalacao: $InstallRoot"
}

$installedFiles = @($manifest.installedFiles | ForEach-Object { [string]$_ })
$previousFiles = @($manifest.previousFiles)
foreach ($relative in $installedFiles) {
    $installedTarget = Resolve-SafeRelativePath $InstallRoot $relative
    if (Test-Path -LiteralPath $installedTarget -PathType Container) {
        throw "Rollback interrompido: um arquivo gerenciado foi substituido por diretorio: $installedTarget"
    }
}
foreach ($entry in $previousFiles) {
    $previousTarget = Resolve-SafeRelativePath $InstallRoot ([string]$entry.path)
    if (Test-Path -LiteralPath $previousTarget -PathType Container) {
        throw "Rollback interrompido: o destino de um arquivo anterior agora e diretorio: $previousTarget"
    }
    $source = Resolve-SafeRelativePath $BackupPath ([string]$entry.backupPath)
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
        throw "Arquivo do backup ausente: $source"
    }
}

$safetyRoot = Join-Path ([IO.Path]::GetTempPath()) ("powerbi-opencode-restore-" + [Guid]::NewGuid().ToString("N"))
$safetyFiles = Join-Path $safetyRoot "files"
Ensure-Directory $safetyFiles
$currentFiles = @()
try {
    $pathsToProtect = @($installedFiles + @($previousFiles | ForEach-Object { [string]$_.path }) | Sort-Object -Unique)
    foreach ($relative in $pathsToProtect) {
        $current = Resolve-SafeRelativePath $InstallRoot $relative
        if (Test-Path -LiteralPath $current -PathType Leaf) {
            $safety = Resolve-SafeRelativePath $safetyFiles $relative
            Ensure-Directory (Split-Path -Parent $safety)
            Copy-Item -LiteralPath $current -Destination $safety -Force
            $currentFiles += $relative
        }
    }

    foreach ($relative in $installedFiles) {
        $target = Resolve-SafeRelativePath $InstallRoot $relative
        if (Test-Path -LiteralPath $target -PathType Leaf) { Remove-Item -LiteralPath $target -Force }
    }
    foreach ($entry in $previousFiles) {
        $source = Resolve-SafeRelativePath $BackupPath ([string]$entry.backupPath)
        $target = Resolve-SafeRelativePath $InstallRoot ([string]$entry.path)
        Ensure-Directory (Split-Path -Parent $target)
        Copy-Item -LiteralPath $source -Destination $target -Force
    }
    Write-Host "Backup restaurado com seguranca: $BackupPath" -ForegroundColor Green
}
catch {
    foreach ($relative in $pathsToProtect) {
        $target = Resolve-SafeRelativePath $InstallRoot $relative
        if (Test-Path -LiteralPath $target -PathType Leaf) { Remove-Item -LiteralPath $target -Force -ErrorAction SilentlyContinue }
    }
    foreach ($relative in $currentFiles) {
        $source = Resolve-SafeRelativePath $safetyFiles $relative
        $target = Resolve-SafeRelativePath $InstallRoot $relative
        Ensure-Directory (Split-Path -Parent $target)
        Copy-Item -LiteralPath $source -Destination $target -Force
    }
    throw "Restauracao falhou e o estado anterior foi recuperado: $($_.Exception.Message)"
}
finally {
    if (Test-Path -LiteralPath $safetyRoot) { Remove-Item -LiteralPath $safetyRoot -Recurse -Force -ErrorAction SilentlyContinue }
}
