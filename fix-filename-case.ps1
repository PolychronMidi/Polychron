# PowerShell script to fix filename case conventions
# Renames only the violating PascalCase .js files to camelCase and updates require statements

param(
    [string]$RootPath = "C:\Users\jackb\Documents\GitHub\polychron-dev\src"
)

# List of files that violate the rule (from ESLint output)
$violatingFiles = @(
    "composers\IntervalComposer.js",
    "composers\MeasureNotePool.js",
    "composers\chord\ChordManager.js",
    "composers\chord\ChordRegistry.js",
    "composers\chord\ChordValues.js",
    "composers\chord\PivotChordBridge.js",
    "composers\factory\FactoryManager.js",
    "composers\motif\CandidateExpansion.js",
    "composers\motif\MotifChain.js",
    "composers\motif\MotifManager.js",
    "composers\motif\MotifRegistry.js",
    "composers\motif\MotifTransformAdvisor.js",
    "composers\motif\MotifTransforms.js",
    "composers\motif\MotifValidators.js",
    "composers\motif\MotifValues.js",
    "composers\voice\RegisterBiasing.js",
    "composers\voice\VoiceLeadingCore.js",
    "composers\voice\VoiceLeadingScorers.js",
    "composers\voice\VoiceRegistry.js",
    "composers\voice\VoiceValues.js",
    "conductor\CoherenceMonitor.js",
    "conductor\ConductorIntelligence.js",
    "conductor\ConductorState.js",
    "conductor\DynamismEngine.js",
    "conductor\GlobalConductor.js",
    "conductor\GlobalConductorUpdate.js",
    "conductor\HarmonicContext.js",
    "conductor\HarmonicJourney.js",
    "conductor\HarmonicRhythmTracker.js",
    "conductor\TextureBlender.js",
    "conductor\dynamics\ClimaxProximityPredictor.js",
    "conductor\dynamics\DensityWaveAnalyzer.js",
    "conductor\dynamics\DurationalContourTracker.js",
    "conductor\dynamics\DynamicArchitectPlanner.js",
    "conductor\dynamics\DynamicPeakMemory.js",
    "conductor\dynamics\DynamicRangeTracker.js",
    "conductor\dynamics\EnergyMomentumTracker.js",
    "conductor\dynamics\VelocityShapeAnalyzer.js",
    "conductor\harmonic\CadenceAdvisor.js",
    "conductor\harmonic\CadentialPreparationAdvisor.js",
    "conductor\harmonic\ChromaticSaturationMonitor.js",
    "conductor\harmonic\ConsonanceDissonanceTracker.js",
    "conductor\harmonic\HarmonicDensityOscillator.js",
    "conductor\harmonic\HarmonicFieldDensityTracker.js",
    "conductor\harmonic\HarmonicPedalFieldTracker.js",
    "conductor\harmonic\HarmonicRhythmDensityRatio.js",
    "conductor\harmonic\HarmonicSurpriseIndex.js",
    "conductor\harmonic\HarmonicVelocityMonitor.js",
    "conductor\harmonic\ModalColorTracker.js",
    "conductor\harmonic\PitchClassGravityMap.js",
    "conductor\harmonic\PitchGravityCenter.js",
    "conductor\harmonic\TensionResolutionTracker.js",
    "conductor\harmonic\TonalAnchorDistanceTracker.js",
    "conductor\melodic\AmbitusMigrationTracker.js",
    "conductor\melodic\CounterpointMotionTracker.js",
    "conductor\melodic\IntervalBalanceTracker.js",
    "conductor\melodic\IntervalDirectionMemory.js",
    "conductor\melodic\IntervalExpansionContractor.js",
    "conductor\melodic\MelodicContourTracker.js",
    "conductor\melodic\OctaveSpreadMonitor.js",
    "conductor\melodic\PhraseContourArchetypeDetector.js",
    "conductor\melodic\RegisterMigrationTracker.js",
    "conductor\melodic\RegisterPressureMonitor.js",
    "conductor\melodic\RegistralVelocityCorrelator.js",
    "conductor\melodic\TessituraPressureMonitor.js",
    "conductor\melodic\ThematicRecallDetector.js",
    "conductor\melodic\VoiceLeadingEfficiencyTracker.js",
    "conductor\rhythmic\AccentPatternTracker.js",
    "conductor\rhythmic\AttackDensityProfiler.js",
    "conductor\rhythmic\GrooveTemplateAdvisor.js",
    "conductor\rhythmic\InterLayerRhythmAnalyzer.js",
    "conductor\rhythmic\OnsetDensityProfiler.js",
    "conductor\rhythmic\OnsetRegularityMonitor.js",
    "conductor\rhythmic\RhythmicComplexityGradient.js",
    "conductor\rhythmic\RhythmicDensityContrastTracker.js",
    "conductor\rhythmic\RhythmicGroupingAnalyzer.js",
    "conductor\rhythmic\RhythmicInertiaTracker.js",
    "conductor\rhythmic\RhythmicSymmetryDetector.js",
    "conductor\rhythmic\SyncopationDensityTracker.js",
    "conductor\rhythmic\TemporalProportionTracker.js",
    "conductor\texture\ArticulationProfiler.js",
    "conductor\texture\CrossLayerDensityBalancer.js",
    "conductor\texture\LayerCoherenceScorer.js",
    "conductor\texture\LayerEntryExitTracker.js",
    "conductor\texture\LayerIndependenceScorer.js",
    "conductor\texture\MotivicDensityTracker.js",
    "conductor\texture\OrchestrationWeightTracker.js",
    "conductor\texture\PedalPointDetector.js",
    "conductor\texture\PhraseLengthMomentumTracker.js",
    "conductor\texture\RepetitionFatigueMonitor.js",
    "conductor\texture\RestDensityTracker.js",
    "conductor\texture\SectionLengthAdvisor.js",
    "conductor\texture\SilenceDistributionTracker.js",
    "conductor\texture\StructuralFormTracker.js",
    "conductor\texture\TexturalGradientTracker.js",
    "conductor\texture\TexturalMemoryAdvisor.js",
    "conductor\texture\TimbreBalanceTracker.js",
    "conductor\texture\VoiceDensityBalancer.js",
    "crossLayer\CrossLayerRegistry.js",
    "fx\noise\NoiseRegistry.js",
    "fx\noise\NoiseValues.js",
    "fx\noise\SimplexNoise.js",
    "fx\stutter\StutterConfigStore.js",
    "fx\stutter\StutterMetrics.js",
    "fx\stutter\StutterRegistry.js",
    "rhythm\ConductorRegulationListener.js",
    "rhythm\DrumTextureCoupler.js",
    "rhythm\EmissionFeedbackListener.js",
    "rhythm\FXFeedbackListener.js",
    "rhythm\FeedbackAccumulator.js",
    "rhythm\JourneyRhythmCoupler.js",
    "rhythm\PhaseLockedRhythmGenerator.js",
    "rhythm\RhythmHistoryTracker.js",
    "rhythm\RhythmManager.js",
    "rhythm\RhythmRegistry.js",
    "rhythm\RhythmValues.js",
    "rhythm\StutterFeedbackListener.js",
    "time\AbsoluteTimeWindow.js",
    "time\TempoFeelEngine.js",
    "time\TimeStream.js",
    "utils\EventCatalog.js",
    "utils\ModuleLifecycle.js",
    "utils\SystemSnapshot.js"
)

Write-Host "Starting filename case convention fixes for violating files..."

$renamedFiles = @{}

foreach ($relativePath in $violatingFiles) {
    $fullPath = Join-Path $RootPath $relativePath
    if (Test-Path $fullPath) {
        $file = Get-Item $fullPath
        $basename = $file.BaseName
        $newBasename = $basename.Substring(0,1).ToLower() + $basename.Substring(1)
        $newPath = Join-Path $file.DirectoryName ($newBasename + ".js")

        Write-Host "Renaming $($file.FullName) to $newPath"
        Rename-Item -Path $file.FullName -NewName ($newBasename + ".js") -Force

        # Store mapping for require updates
        $renamedFiles[$relativePath] = $relativePath.Replace($basename + ".js", $newBasename + ".js")
    } else {
        Write-Warning "File not found: $fullPath"
    }
}

# Update validator.create() calls in the renamed files
foreach ($oldRelativePath in $renamedFiles.Keys) {
    $newRelativePath = $renamedFiles[$oldRelativePath]
    $fullPath = Join-Path $RootPath $newRelativePath
    if (Test-Path $fullPath) {
        $content = Get-Content -Path $fullPath -Raw
        $oldBasename = [System.IO.Path]::GetFileNameWithoutExtension($oldRelativePath)
        $newBasename = [System.IO.Path]::GetFileNameWithoutExtension($newRelativePath)

        # Replace validator.create('OldName') with validator.create('newName')
        $oldValidator = "validator.create('$oldBasename')"
        $newValidator = "validator.create('$newBasename')"

        if ($content -match [regex]::Escape($oldValidator)) {
            $content = $content -replace [regex]::Escape($oldValidator), $newValidator
            Set-Content -Path $fullPath -Value $content -Encoding UTF8
            Write-Host ("Updated validator.create in {0}: {1} -> {2}" -f $fullPath, $oldValidator, $newValidator)
        }
    }
}

# Now update require statements in index.js files
$indexFiles = Get-ChildItem -Path $RootPath -Recurse -Filter "index.js" -File

foreach ($indexFile in $indexFiles) {
    $content = Get-Content -Path $indexFile.FullName -Raw

    $updated = $false
    foreach ($oldRelativePath in $renamedFiles.Keys) {
        $newRelativePath = $renamedFiles[$oldRelativePath]

        # Extract filename without extension for require matching
        $oldFilename = [System.IO.Path]::GetFileNameWithoutExtension($oldRelativePath)
        $newFilename = [System.IO.Path]::GetFileNameWithoutExtension($newRelativePath)

        # Update require statements like require('./OldName')
        $oldRequire = "require('./$oldFilename')"
        $newRequire = "require('./$newFilename')"

        if ($content -match [regex]::Escape($oldRequire)) {
            $content = $content -replace [regex]::Escape($oldRequire), $newRequire
            $updated = $true
            Write-Host "Updated require in $($indexFile.FullName): $oldRequire -> $newRequire"
        }

        # Also check for require('./OldName.js')
        $oldRequireJs = "require('./$oldFilename.js')"
        $newRequireJs = "require('./$newFilename.js')"

        if ($content -match [regex]::Escape($oldRequireJs)) {
            $content = $content -replace [regex]::Escape($oldRequireJs), $newRequireJs
            $updated = $true
            Write-Host "Updated require in $($indexFile.FullName): $oldRequireJs -> $newRequireJs"
        }
    }

    if ($updated) {
        Set-Content -Path $indexFile.FullName -Value $content -Encoding UTF8
    }
}

# Fix the function naming in VoiceRegistry.js (now voiceRegistry.js)
$voiceRegistryPath = Join-Path $RootPath "composers\voice\voiceRegistry.js"
if (Test-Path $voiceRegistryPath) {
    $content = Get-Content -Path $voiceRegistryPath -Raw
    $content = $content -replace "function VoiceRegistry", "function voiceRegistry"
    Set-Content -Path $voiceRegistryPath -Value $content -Encoding UTF8
    Write-Host "Renamed function VoiceRegistry to voiceRegistry in $voiceRegistryPath"
}

Write-Host "Filename case convention fixes completed."
Write-Host "Renamed $($renamedFiles.Count) files and updated corresponding require statements."
