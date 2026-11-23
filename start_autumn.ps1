$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $repoRoot

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw 'Node.js 22 or newer is required.'
}

Write-Host 'Autumn will be at http://127.0.0.1:8787'
Write-Host 'Press Ctrl+C to stop her local service.'
node src/server.mjs
