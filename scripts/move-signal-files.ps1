# Move 13 signal/pipeline infrastructure files into src/conductor/signal/
$files = @(
    "pipelineNormalizer.js",
    "coherenceMonitor.js",
    "signalReader.js",
    "profileAdaptation.js",
    "signalTelemetry.js",
    "signalHealthAnalyzer.js",
    "systemDynamicsProfiler.js",
    "regimeReactiveDamping.js",
    "pipelineBalancer.js",
    "pipelineCouplingManager.js",
    "narrativeTrajectory.js",
    "structuralNarrativeAdvisor.js",
    "criticalityEngine.js"
)

$src = "src/conductor"
$dst = "src/conductor/signal"

foreach ($f in $files) {
    $from = Join-Path $src $f
    $to   = Join-Path $dst $f
    if (Test-Path $from) {
        Move-Item $from $to -Force
        Write-Host "Moved $f"
    } else {
        Write-Host "NOT FOUND: $from" -ForegroundColor Red
    }
}

Write-Host "`nDone. $($files.Count) files targeted." -ForegroundColor Green
