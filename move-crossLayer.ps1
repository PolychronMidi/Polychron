# move-crossLayer.ps1 — Moves crossLayer modules into their new subfolders.
# Run from repo root:  .\move-crossLayer.ps1

$base = "src/crossLayer"

# ── harmony (9 files) ──────────────────────────────────────────────
$harmony = @(
    "cadenceAlignment.js"
    "convergenceHarmonicTrigger.js"
    "harmonicIntervalGuard.js"
    "motifEcho.js"
    "motifIdentityMemory.js"
    "phaseAwareCadenceWindow.js"
    "pitchMemoryRecall.js"
    "registerCollisionAvoider.js"
    "spectralComplementarity.js"
)

# ── rhythm (8 files) ───────────────────────────────────────────────
$rhythm = @(
    "convergenceDetector.js"
    "emergentDownbeat.js"
    "feedbackOscillator.js"
    "grooveTransfer.js"
    "rhythmicComplementEngine.js"
    "rhythmicPhaseLock.js"
    "stutterContagion.js"
    "temporalGravity.js"
)

# ── dynamics (6 files) ─────────────────────────────────────────────
$dynamics = @(
    "articulationComplement.js"
    "crossLayerDynamicEnvelope.js"
    "dynamicRoleSwap.js"
    "restSynchronizer.js"
    "texturalMirror.js"
    "velocityInterference.js"
)

# ── structure (7 files) ────────────────────────────────────────────
$structure = @(
    "adaptiveTrustScores.js"
    "crossLayerClimaxEngine.js"
    "crossLayerSilhouette.js"
    "entropyRegulator.js"
    "interactionHeatMap.js"
    "negotiationEngine.js"
    "sectionIntentCurves.js"
)

$moves = @{
    "harmony"   = $harmony
    "rhythm"    = $rhythm
    "dynamics"  = $dynamics
    "structure" = $structure
}

$total = 0
$errors = 0

foreach ($folder in $moves.Keys) {
    $dest = "$base/$folder"
    foreach ($file in $moves[$folder]) {
        $src = "$base/$file"
        if (Test-Path $src) {
            Move-Item $src $dest -Force
            Write-Host "  OK  $src -> $dest/$file"
            $total++
        } else {
            Write-Host "  MISSING  $src" -ForegroundColor Red
            $errors++
        }
    }
}

Write-Host ""
Write-Host "Moved $total files ($errors errors)."
if ($errors -eq 0) {
    Write-Host "Done — run 'npm run main' to validate." -ForegroundColor Green
} else {
    Write-Host "Some files were missing — check above." -ForegroundColor Yellow
}
