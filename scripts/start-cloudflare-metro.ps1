# Exposes Metro (Expo) on port 8081 for remote testers.
# Use when ngrok is already used for faceid-server (port 4001) — free ngrok = 1 tunnel.
#
# 1. Run: npx expo start --lan -c   (in Mobile/app)
# 2. Run this script — copy the https://....trycloudflare.com URL
# 3. Expo Go → Enter URL manually → paste that https URL

$cloudflared = "C:\Program Files (x86)\cloudflared\cloudflared.exe"
if (-not (Test-Path $cloudflared)) {
  $cloudflared = "cloudflared"
}

Write-Host "Tunneling Metro at http://127.0.0.1:8081 — start Expo first: npx expo start --lan -c" -ForegroundColor Cyan
& $cloudflared tunnel --url http://127.0.0.1:8081
