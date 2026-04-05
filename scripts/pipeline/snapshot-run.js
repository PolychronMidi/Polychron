'use strict';
// Pipeline step: snapshot run features for quality predictor training.
// Saves golden-fingerprint + trace-summary subset + metadata to
// metrics/run-history/{ISO-timestamp}.json. Accumulates across runs.
// Label with verdict later via: node scripts/pipeline/snapshot-run.js --label STABLE

const fs = require('fs');
const path = require('path');

const HISTORY_DIR = path.join(__dirname, '..', '..', 'metrics', 'run-history');
const FP_PATH = path.join(__dirname, '..', '..', 'metrics', 'golden-fingerprint.json');
const TS_PATH = path.join(__dirname, '..', '..', 'metrics', 'trace-summary.json');

function extractFeatures() {
  const fp = JSON.parse(fs.readFileSync(FP_PATH, 'utf-8'));
  const ts = JSON.parse(fs.readFileSync(TS_PATH, 'utf-8'));

  const rd = fp.regimeDistribution || {};
  const density = fp.density || {};
  const nc = fp.noteCount || {};
  const th = fp.telemetryHealth || {};
  const exc = fp.exceedanceComposite || {};
  const hm = fp.hotspotMigration || {};
  const axis = (hm.axisShares) || {};

  // Axis Gini coefficient
  const axisVals = ['density', 'tension', 'flicker', 'entropy', 'trust', 'phase']
    .map(a => axis[a] || 0);
  const axisMean = axisVals.reduce((a, b) => a + b, 0) / axisVals.length;
  const axisGini = axisMean > 0
    ? axisVals.reduce((s, v) => s + Math.abs(v - axisMean), 0) / (2 * axisVals.length * axisMean)
    : 0;

  // Section stats from trace-summary
  const sectionStats = (ts.sectionStats || []).map(s => ({
    beats: s.beats || 0,
    dominantRegime: s.dominantRegime || '?',
    tensionMean: s.tensionMean || 0,
    tensionPeak: s.tensionPeak || 0,
    profile: s.profile || '?',
  }));

  // Trust ecology summary
  const trustFinal = fp.trustFinal || {};
  const trustWeights = Object.entries(trustFinal)
    .map(([name, data]) => ({ name, weight: data.weight || 0, score: data.score || 0 }))
    .sort((a, b) => b.weight - a.weight);

  // Coupling label diversity
  const couplingLabels = ts.couplingLabels || {};
  const labelCount = Object.keys(couplingLabels).length;

  return {
    // Core regime balance
    coherentShare: rd.coherent || 0,
    exploringShare: rd.exploring || 0,
    evolvingShare: rd.evolving || 0,

    // Density/pitch
    densityMean: density.mean || 0,
    densityVariance: density.variance || 0,
    pitchEntropy: fp.pitchEntropy || 0,

    // Trust ecology
    trustConvergence: fp.trustConvergence || 0,
    topTrustSystem: trustWeights[0] ? trustWeights[0].name : '',
    topTrustWeight: trustWeights[0] ? trustWeights[0].weight : 0,
    trustWeightSpread: trustWeights.length > 1
      ? trustWeights[0].weight - trustWeights[trustWeights.length - 1].weight
      : 0,

    // Health
    healthScore: th.score || 0,
    exceedanceRate: exc.uniqueRate || 0,
    correlationExtremes: fp.correlationExtremeCount || 0,

    // Structure
    totalNotes: nc.total || 0,
    traceEntries: (fp.meta || {}).traceEntries || 0,
    sectionCount: sectionStats.length,
    axisGini: axisGini,
    couplingLabelCount: labelCount,

    // Tension arc
    tensionArcShape: sectionStats.length >= 2
      ? (sectionStats.slice(0, Math.ceil(sectionStats.length / 2))
          .reduce((s, x) => s + x.tensionMean, 0) / Math.ceil(sectionStats.length / 2)) -
        (sectionStats.slice(Math.ceil(sectionStats.length / 2))
          .reduce((s, x) => s + x.tensionMean, 0) / Math.floor(sectionStats.length / 2))
      : 0,

    // Section detail (compact)
    sections: sectionStats,
  };
}

function main() {
  const args = process.argv.slice(2);

  // --label MODE: label the most recent unlabeled snapshot
  if (args[0] === '--label' && args[1]) {
    const verdict = args[1]; // STABLE, EVOLVED, DRIFTED, LEGENDARY
    const files = fs.readdirSync(HISTORY_DIR)
      .filter(f => f.endsWith('.json'))
      .sort()
      .reverse();
    for (const f of files) {
      const fpath = path.join(HISTORY_DIR, f);
      const data = JSON.parse(fs.readFileSync(fpath, 'utf-8'));
      if (!data.verdict) {
        data.verdict = verdict;
        data.labeledAt = new Date().toISOString();
        fs.writeFileSync(fpath, JSON.stringify(data, null, 2));
        console.log(`Labeled ${f} as ${verdict}`);
        return;
      }
    }
    console.log('No unlabeled snapshots found.');
    return;
  }

  // --stats: show collection progress
  if (args[0] === '--stats') {
    const files = fs.readdirSync(HISTORY_DIR).filter(f => f.endsWith('.json'));
    const labeled = files.filter(f => {
      const d = JSON.parse(fs.readFileSync(path.join(HISTORY_DIR, f), 'utf-8'));
      return !!d.verdict;
    });
    console.log(`Run history: ${files.length} snapshots, ${labeled.length} labeled`);
    const verdicts = {};
    for (const f of labeled) {
      const d = JSON.parse(fs.readFileSync(path.join(HISTORY_DIR, f), 'utf-8'));
      verdicts[d.verdict] = (verdicts[d.verdict] || 0) + 1;
    }
    if (Object.keys(verdicts).length > 0) {
      console.log('Verdicts:', Object.entries(verdicts).map(([k, v]) => `${k}:${v}`).join(', '));
    }
    const readyForTraining = labeled.length >= 15;
    console.log(readyForTraining
      ? `Ready for Phase 1 training (${labeled.length} >= 15 labeled)`
      : `Need ${15 - labeled.length} more labeled runs for Phase 1 training`);
    return;
  }

  // Default: save snapshot
  if (!fs.existsSync(FP_PATH) || !fs.existsSync(TS_PATH)) {
    console.log('Skipping snapshot: fingerprint or trace-summary not found.');
    return;
  }

  const features = extractFeatures();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const snapshot = {
    timestamp: new Date().toISOString(),
    features: features,
    verdict: null,  // labeled later via --label
    profile: features.sections[0] ? features.sections[0].profile : 'unknown',
  };

  // --perceptual: run EnCodec analysis and attach to snapshot
  // Only if WAV is newer than trace-summary (same pipeline run)
  const WAV_PATH = path.join(__dirname, '..', '..', 'output', 'combined.wav');
  const wavFresh = fs.existsSync(WAV_PATH) &&
    fs.statSync(WAV_PATH).mtimeMs > fs.statSync(TS_PATH).mtimeMs - 600000; // within 10min
  if (args.includes('--perceptual') && !wavFresh && fs.existsSync(WAV_PATH)) {
    console.log('  ! Skipping perceptual: combined.wav is stale (older than trace-summary). Run `npm run render` first.');
  }
  if (args.includes('--perceptual') && wavFresh) {
    try {
      const { execSync } = require('child_process');
      const pyScript = `
import json, torch, torchaudio, numpy as np
from encodec import EncodecModel
from encodec.utils import convert_audio

model = EncodecModel.encodec_model_24khz()
model.set_target_bandwidth(6.0)
model.to('cuda' if torch.cuda.is_available() else 'cpu').eval()
wav, sr = torchaudio.load('${WAV_PATH.replace(/'/g, "\\'")}')
wav = convert_audio(wav, sr, model.sample_rate, model.channels).unsqueeze(0).to(next(model.parameters()).device)
codes_list = []
with torch.no_grad():
    for s in range(0, wav.shape[-1], model.sample_rate*30):
        c = wav[..., s:s+model.sample_rate*30]
        if c.shape[-1] < model.sample_rate: continue
        codes_list.append(model.encode(c)[0][0][0].cpu())
codes = torch.cat(codes_list, dim=-1)
result = {}
for cb in range(min(codes.shape[0], 4)):
    t = codes[cb].numpy()
    u, c = np.unique(t, return_counts=True)
    p = c/c.sum()
    result[f'cb{cb}_entropy'] = float(-np.sum(p*np.log2(p+1e-10)))
    result[f'cb{cb}_unique'] = int(len(u))
result['total_frames'] = int(codes.shape[1])
result['codebooks'] = int(codes.shape[0])
print(json.dumps(result))
`;
      const output = execSync(`python3 -c '${pyScript.replace(/'/g, "'\\''")}'`, {
        timeout: 120000, encoding: 'utf-8',
        env: { ...process.env, PYTHONPATH: '/home/jah/.local/lib/python3.12/site-packages' },
      }).trim();
      snapshot.perceptual = { encodec: JSON.parse(output) };
      console.log(`  + EnCodec: ${snapshot.perceptual.encodec.codebooks} codebooks, CB0 entropy=${snapshot.perceptual.encodec.cb0_entropy.toFixed(2)}`);
    } catch (e) {
      console.log(`  ! EnCodec analysis failed: ${e.message.slice(0, 80)}`);
    }
  }

  const outPath = path.join(HISTORY_DIR, `${timestamp}.json`);
  fs.writeFileSync(outPath, JSON.stringify(snapshot, null, 2));
  console.log(`Snapshot saved: ${path.basename(outPath)} (${features.traceEntries} beats, ${features.sectionCount} sections)`);
}

main();
