# Builds the Chrome Web Store upload package:
#   dist/sf-industries-error-inspector-<version>.zip
# The version is read from manifest.json. Only runtime files are included.
#
# Usage (from anywhere):  powershell -File scripts/build-zip.ps1

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$manifest = Get-Content (Join-Path $root "manifest.json") -Raw | ConvertFrom-Json
$version = $manifest.version

$files = @(
  "manifest.json",
  "devtools.html",
  "devtools.js",
  "panel.html",
  "panel.js",
  "panel.css",
  "icons/icon16.png",
  "icons/icon48.png",
  "icons/icon128.png"
)

foreach ($f in $files) {
  if (-not (Test-Path (Join-Path $root $f))) { throw "Missing file: $f" }
}

$dist = Join-Path $root "dist"
New-Item -ItemType Directory -Force $dist | Out-Null
$zipPath = Join-Path $dist "sf-industries-error-inspector-$version.zip"
if (Test-Path $zipPath) { Remove-Item $zipPath }

# Use ZipArchive directly instead of Compress-Archive: Windows PowerShell 5.1's
# Compress-Archive writes "\" path separators, which the Web Store rejects.
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::Open($zipPath, "Create")
try {
  foreach ($f in $files) {
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
      $zip, (Join-Path $root $f), $f, "Optimal") | Out-Null
  }
} finally {
  $zip.Dispose()
}

Write-Host "Built $zipPath"
