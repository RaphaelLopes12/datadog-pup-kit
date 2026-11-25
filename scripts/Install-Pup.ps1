[CmdletBinding()]
param(
    [string]$Version = 'latest',
    [string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'Programs\pup'),
    [switch]$NoPathUpdate,
    [switch]$Force
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$repository = 'DataDog/pup'
$binaryName = 'pup.exe'

[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
if ($null -ne [Net.WebRequest]::DefaultWebProxy) {
    [Net.WebRequest]::DefaultWebProxy.Credentials = [Net.CredentialCache]::DefaultNetworkCredentials
}

function Resolve-PupVersion {
    param([string]$Requested)

    if ($Requested -ne 'latest') {
        return $Requested.TrimStart('v')
    }

    $release = Invoke-RestMethod -Uri "https://api.github.com/repos/$repository/releases/latest" -Headers @{ 'User-Agent' = 'pup-installer' }
    return ([string]$release.tag_name).TrimStart('v')
}

function Get-InstalledPupVersion {
    param([string]$BinaryPath)

    if (-not (Test-Path $BinaryPath)) {
        return $null
    }

    $output = & $BinaryPath --version
    if ("$output" -match '(\d+\.\d+\.\d+)') {
        return $Matches[1]
    }

    return $null
}

function Get-ExpectedHash {
    param([string]$ChecksumsPath, [string]$AssetName)

    foreach ($line in Get-Content $ChecksumsPath) {
        $parts = $line -split '\s+', 2
        if ($parts.Count -eq 2 -and $parts[1].TrimStart('*') -eq $AssetName) {
            return $parts[0].ToLowerInvariant()
        }
    }

    throw "Checksum for $AssetName not found in $ChecksumsPath"
}

function Add-ToUserPath {
    param([string]$Directory)

    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    $entries = @()
    if ($userPath) {
        $entries = $userPath -split ';' | Where-Object { $_ }
    }

    if ($entries -notcontains $Directory) {
        $updated = (@($entries) + $Directory) -join ';'
        [Environment]::SetEnvironmentVariable('Path', $updated, 'User')
        Write-Host "Added $Directory to the user PATH. Reopen terminals and Cursor to pick it up."
    }

    if (($env:Path -split ';') -notcontains $Directory) {
        $env:Path = "$env:Path;$Directory"
    }
}

if (-not [Environment]::Is64BitOperatingSystem) {
    throw 'Only Windows x64 builds are published.'
}

$targetVersion = Resolve-PupVersion -Requested $Version
$binaryPath = Join-Path $InstallDir $binaryName
$installedVersion = Get-InstalledPupVersion -BinaryPath $binaryPath

if ($installedVersion -eq $targetVersion -and -not $Force) {
    Write-Host "pup $installedVersion is already installed at $binaryPath"
    if (-not $NoPathUpdate) {
        Add-ToUserPath -Directory $InstallDir
    }
    return
}

$assetName = "pup_${targetVersion}_Windows_x86_64.zip"
$checksumsName = "pup_${targetVersion}_checksums.txt"
$baseUrl = "https://github.com/$repository/releases/download/v$targetVersion"
$workDir = Join-Path ([IO.Path]::GetTempPath()) ("pup-install-" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $workDir | Out-Null

try {
    $archivePath = Join-Path $workDir $assetName
    $checksumsPath = Join-Path $workDir $checksumsName

    Write-Host "Downloading pup $targetVersion"
    Invoke-WebRequest -Uri "$baseUrl/$checksumsName" -OutFile $checksumsPath -UseBasicParsing
    Invoke-WebRequest -Uri "$baseUrl/$assetName" -OutFile $archivePath -UseBasicParsing

    $expectedHash = Get-ExpectedHash -ChecksumsPath $checksumsPath -AssetName $assetName
    $actualHash = (Get-FileHash -Path $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualHash -ne $expectedHash) {
        throw "SHA-256 mismatch for $assetName. Expected $expectedHash, got $actualHash."
    }

    $extractDir = Join-Path $workDir 'extracted'
    Expand-Archive -Path $archivePath -DestinationPath $extractDir -Force

    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
    Copy-Item -Path (Join-Path $extractDir $binaryName) -Destination $binaryPath -Force
}
finally {
    Remove-Item -Path $workDir -Recurse -Force -ErrorAction SilentlyContinue
}

if (-not $NoPathUpdate) {
    Add-ToUserPath -Directory $InstallDir
}

Write-Host "Installed: $(& $binaryPath --version)"
Write-Host "Location:  $binaryPath"
