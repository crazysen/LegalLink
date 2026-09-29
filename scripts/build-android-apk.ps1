# Build BatasMo Android APK via EAS (Option A).
# Prerequisite: eas login  (once per machine)
$ErrorActionPreference = "Stop"
$AppRoot = Join-Path $PSScriptRoot ".." "app"
Set-Location $AppRoot

Write-Host "Checking EAS login..." -ForegroundColor Cyan
npx eas-cli whoami
if ($LASTEXITCODE -ne 0) {
  Write-Host "Not logged in. Run: npx eas-cli login" -ForegroundColor Yellow
  npx eas-cli login
}

if (-not (Test-Path "eas.json")) {
  Write-Error "Missing eas.json in $AppRoot"
}

if (-not ((Get-Content app.json -Raw) -match '"projectId"')) {
  Write-Error "Missing extra.eas.projectId in app.json. Run: npx eas-cli init, then paste the projectId into app.json."
}

Write-Host "Starting cloud APK build (profile: preview)..." -ForegroundColor Cyan
Write-Host "When finished, download the .apk from the URL printed below or expo.dev -> Builds." -ForegroundColor Gray
npx eas-cli build -p android --profile preview
