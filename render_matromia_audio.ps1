$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$sourceDir = Join-Path $projectRoot 'audio_script'
$outputDir = Join-Path $projectRoot 'output\speech'
$tempDir = Join-Path $projectRoot 'tmp\speech'
$jobsPath = Join-Path $tempDir 'matromia_jobs.jsonl'
$instructionsPath = Join-Path $projectRoot 'Matromia_Audio_Instructions.txt'
$ttsCli = Join-Path $env:USERPROFILE '.codex\skills\speech\scripts\text_to_speech.py'

if (-not $env:OPENAI_API_KEY) {
    throw 'OPENAI_API_KEY is not set. Set it locally, reopen the terminal/app, and run this again.'
}

if (-not (Test-Path -LiteralPath $ttsCli)) {
    throw "Speech generator not found at $ttsCli"
}

New-Item -ItemType Directory -Force -Path $outputDir, $tempDir | Out-Null

$instructions = Get-Content -LiteralPath $instructionsPath -Raw
$jobs = foreach ($file in Get-ChildItem -LiteralPath $sourceDir -Filter '*.txt' | Sort-Object Name) {
    $text = Get-Content -LiteralPath $file.FullName -Raw
    if ($text.Length -gt 4096) {
        throw "$($file.Name) is longer than the 4096-character speech limit."
    }

    [ordered]@{
        input = $text
        voice = 'marin'
        instructions = $instructions
        response_format = 'mp3'
        speed = 1.04
        out = "$($file.BaseName).mp3"
    } | ConvertTo-Json -Compress
}

try {
    Set-Content -LiteralPath $jobsPath -Value $jobs -Encoding utf8
    & py -3 $ttsCli speak-batch --input $jobsPath --out-dir $outputDir --rpm 40 --force
    if ($LASTEXITCODE -ne 0) {
        throw "Speech generation failed with exit code $LASTEXITCODE."
    }
}
finally {
    Remove-Item -LiteralPath $jobsPath -Force -ErrorAction SilentlyContinue
}

Write-Host "Finished. Audio chapters are in $outputDir"
