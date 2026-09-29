# Exposes faceid-server (Didit proxy) to the internet for remote testers.
# Usage: .\start-ngrok-didit.ps1
# Copy the https://....ngrok-free.app URL into Mobile/app/.env:
#   EXPO_PUBLIC_DIDIT_PROXY_URL=https://YOUR-URL
# Then restart Expo with: npx expo start --tunnel -c

$ErrorActionPreference = "Stop"
Write-Host "Starting ngrok tunnel to http://127.0.0.1:4001 (faceid-server must be running)" -ForegroundColor Cyan
Write-Host "Paste the https forwarding URL into EXPO_PUBLIC_DIDIT_PROXY_URL in Mobile/app/.env" -ForegroundColor Yellow
ngrok http 4001
