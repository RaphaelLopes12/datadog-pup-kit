[CmdletBinding()]
param(
    [string]$Site,
    [string]$Org,
    [string]$OrgUuid,
    [switch]$PersistSite,
    [switch]$AllowWrite
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$pup = Get-Command pup -ErrorAction SilentlyContinue
if (-not $pup) {
    throw 'pup was not found in PATH. Run scripts\Install-Pup.ps1 and reopen the terminal.'
}

$loginArguments = @('auth', 'login')
$statusArguments = @('auth', 'status')

if ($Site) {
    $loginArguments += @('--site', $Site)
    $statusArguments += @('--site', $Site)
}

if ($Org) {
    $loginArguments += @('--org', $Org)
    $statusArguments += @('--org', $Org)
}

if ($OrgUuid) {
    $loginArguments += @('--org-uuid', $OrgUuid)
}

if (-not $AllowWrite) {
    $loginArguments += '--read-only'
}

& $pup.Source @loginArguments
if ($LASTEXITCODE -ne 0) {
    throw "pup auth login failed with exit code $LASTEXITCODE"
}

if ($Site -and $PersistSite) {
    [Environment]::SetEnvironmentVariable('DD_SITE', $Site, 'User')
    $env:DD_SITE = $Site
    Write-Host "DD_SITE=$Site saved for the current user. Reopen terminals and Cursor to pick it up."
}

& $pup.Source @statusArguments
