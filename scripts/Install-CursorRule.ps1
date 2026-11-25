[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$RepoPath,
    [switch]$ExcludeFromGit
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ruleName = 'datadog-pup.mdc'
$source = Join-Path $PSScriptRoot "..\cursor\rules\$ruleName"
$repository = (Resolve-Path $RepoPath).Path
$rulesDir = Join-Path $repository '.cursor\rules'

New-Item -ItemType Directory -Path $rulesDir -Force | Out-Null
Copy-Item -Path $source -Destination (Join-Path $rulesDir $ruleName) -Force
Write-Host "Rule installed at $(Join-Path $rulesDir $ruleName)"

if ($ExcludeFromGit) {
    $excludeFile = Join-Path $repository '.git\info\exclude'
    if (-not (Test-Path (Split-Path $excludeFile))) {
        throw "$repository is not a git repository root."
    }

    $entry = ".cursor/rules/$ruleName"
    $existing = @()
    if (Test-Path $excludeFile) {
        $existing = Get-Content $excludeFile
    }

    if ($existing -notcontains $entry) {
        Add-Content -Path $excludeFile -Value $entry -Encoding ascii
        Write-Host "Added $entry to .git/info/exclude"
    }
}
