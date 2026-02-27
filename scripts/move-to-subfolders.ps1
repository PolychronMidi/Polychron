<#
  move-to-subfolders.ps1
  Moves files into the 3 new subfolders introduced for code organization.
  Run from the repo root: .\move-to-subfolders.ps1
#>

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot | Split-Path   # repo root (script lives in scripts/)

# If running from repo root directly, adjust
if (Test-Path (Join-Path $PWD 'src')) { $root = $PWD }

$src = Join-Path $root 'src'

Write-Host "`n=== Moving files into new subfolders ===`n" -ForegroundColor Cyan

# ── 1. src/rhythm/feedback/ ──
$feedbackDir = Join-Path $src 'rhythm\feedback'
$feedbackFiles = @(
    'feedbackAccumulator.js',
    'fXFeedbackListener.js',
    'stutterFeedbackListener.js',
    'emissionFeedbackListener.js',
    'journeyRhythmCoupler.js',
    'conductorRegulationListener.js'
)

Write-Host "1) rhythm/feedback/ ($($feedbackFiles.Count) files)" -ForegroundColor Yellow
foreach ($f in $feedbackFiles) {
    $from = Join-Path $src "rhythm\$f"
    $to   = Join-Path $feedbackDir $f
    if (Test-Path $from) {
        Move-Item $from $to -Force
        Write-Host "   moved $f" -ForegroundColor Green
    } else {
        Write-Host "   SKIP  $f (not found)" -ForegroundColor Red
    }
}

# ── 2. src/rhythm/drums/ ──
$drumsDir = Join-Path $src 'rhythm\drums'
$drumsFiles = @(
    'drumMap.js',
    'drummer.js',
    'drumTextureCoupler.js',
    'playDrums.js',
    'playDrums2.js'
)

Write-Host "`n2) rhythm/drums/ ($($drumsFiles.Count) files)" -ForegroundColor Yellow
foreach ($f in $drumsFiles) {
    $from = Join-Path $src "rhythm\$f"
    $to   = Join-Path $drumsDir $f
    if (Test-Path $from) {
        Move-Item $from $to -Force
        Write-Host "   moved $f" -ForegroundColor Green
    } else {
        Write-Host "   SKIP  $f (not found)" -ForegroundColor Red
    }
}

# ── 3. src/conductor/journey/ ──
$journeyDir = Join-Path $src 'conductor\journey'
$journeyFiles = @(
    'harmonicContext.js',
    'harmonicJourney.js',
    'harmonicJourneyHelpers.js',
    'harmonicJourneyPlanner.js',
    'harmonicRhythmTracker.js'
)

Write-Host "`n3) conductor/journey/ ($($journeyFiles.Count) files)" -ForegroundColor Yellow
foreach ($f in $journeyFiles) {
    $from = Join-Path $src "conductor\$f"
    $to   = Join-Path $journeyDir $f
    if (Test-Path $from) {
        Move-Item $from $to -Force
        Write-Host "   moved $f" -ForegroundColor Green
    } else {
        Write-Host "   SKIP  $f (not found)" -ForegroundColor Red
    }
}

Write-Host "`n=== Done. 16 files moved into 3 subfolders. ===" -ForegroundColor Cyan
Write-Host "Run 'npm run main' to verify everything loads correctly.`n"
