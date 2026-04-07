'use strict';
// Train lightweight verdict regressor from labeled run-history snapshots.
// Uses Python/sklearn LogisticRegression (L2, C=0.5) on numeric features.
// Saves weights to metrics/verdict-model.json for prediction in snapshot-run.js.
// Skips if fewer than MIN_LABELED labeled snapshots exist.
// Usage: node scripts/pipeline/train-verdict-predictor.js

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const HISTORY_DIR = path.join(__dirname, '..', '..', 'metrics', 'run-history');
const MODEL_PATH = path.join(__dirname, '..', '..', 'metrics', 'verdict-model.json');
const MIN_LABELED = 10;

const FEATURES = [
  'coherentShare', 'exploringShare', 'evolvingShare',
  'densityMean', 'densityVariance', 'pitchEntropy',
  'trustConvergence', 'topTrustWeight', 'trustWeightSpread',
  'healthScore', 'exceedanceRate',
  'totalNotes', 'axisGini', 'couplingLabelCount', 'tensionArcShape',
  'cb0Entropy',  // perceptual: EnCodec CB0 token entropy (musical complexity)
];

function main() {
  if (!fs.existsSync(HISTORY_DIR)) {
    console.log('Verdict predictor: no run-history dir. Skipping.');
    return;
  }

  const files = fs.readdirSync(HISTORY_DIR).filter(f => f.endsWith('.json')).sort();
  const labeled = [];
  for (const f of files) {
    const d = JSON.parse(fs.readFileSync(path.join(HISTORY_DIR, f), 'utf-8'));
    if (d.verdict && d.features) {
      const ft = d.features;
      // cb0Entropy: prefer features.cb0Entropy, fall back to perceptual.encodec.cb0_entropy.
      // Store raw value (or null if missing) — will impute with mean below.
      const cb0Raw = typeof ft.cb0Entropy === 'number' ? ft.cb0Entropy
        : (d.perceptual && d.perceptual.encodec && typeof d.perceptual.encodec.cb0_entropy === 'number')
          ? d.perceptual.encodec.cb0_entropy : null;
      labeled.push({ verdict: d.verdict, features: ft, cb0Raw });
    }
  }

  // Impute missing cb0Entropy with mean of observed values (not 0 — that contaminates weights)
  const cb0Observed = labeled.map(l => l.cb0Raw).filter(v => v !== null);
  const cb0Mean = cb0Observed.length > 0
    ? cb0Observed.reduce((a, b) => a + b, 0) / cb0Observed.length : 6.1;

  const labeledFinal = labeled.map(l => ({
    verdict: l.verdict,
    features: FEATURES.map(k => {
      if (k === 'cb0Entropy') return l.cb0Raw !== null ? l.cb0Raw : cb0Mean;
      return typeof l.features[k] === 'number' ? l.features[k] : 0;
    }),
  }));

  if (labeledFinal.length < MIN_LABELED) {
    console.log(`Verdict predictor: ${labeledFinal.length} labeled snapshots (need ${MIN_LABELED}). Skipping training.`);
    return;
  }

  const legendaryCount = labeledFinal.filter(l => l.verdict === 'LEGENDARY').length;
  const stableCount = labeledFinal.filter(l => l.verdict === 'STABLE').length;
  const cb0Imputed = labeled.filter(l => l.cb0Raw === null).length;
  console.log(`Training verdict predictor: ${labeledFinal.length} samples (${legendaryCount} LEGENDARY, ${stableCount} STABLE, ${cb0Imputed} cb0 imputed with mean=${cb0Mean.toFixed(3)})`);

  const trainJson = JSON.stringify({ samples: labeledFinal, features: FEATURES });

  const pyScript = `
import json, sys, numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler
from sklearn.model_selection import cross_val_score

data = json.loads(sys.argv[1])
samples = data['samples']
features = data['features']

X = np.array([s['features'] for s in samples], dtype=np.float64)
# Binary: LEGENDARY=1, everything else=0
y = np.array([1 if s['verdict'] == 'LEGENDARY' else 0 for s in samples])

scaler = StandardScaler()
X_scaled = scaler.fit_transform(X)

# L2 logistic regression, C=0.5 (moderate regularization for small datasets)
clf = LogisticRegression(C=0.5, max_iter=500, random_state=42, class_weight='balanced')
clf.fit(X_scaled, y)

# Cross-validation accuracy (leave-one-out for small datasets)
if len(samples) >= 6:
    from sklearn.model_selection import StratifiedKFold
    cv = min(5, len(samples))
    cv_scores = cross_val_score(clf, X_scaled, y, cv=cv, scoring='accuracy')
    cv_acc = float(cv_scores.mean())
else:
    cv_acc = float((clf.predict(X_scaled) == y).mean())

model = {
    'features': features,
    'coef': clf.coef_[0].tolist(),
    'intercept': float(clf.intercept_[0]),
    'scale_mean': scaler.mean_.tolist(),
    'scale_std': scaler.scale_.tolist(),
    'threshold': 0.5,
    'cv_accuracy': cv_acc,
    'n_samples': len(samples),
    'n_legendary': int(y.sum()),
    'n_stable': int((y == 0).sum()),
    'feature_importance': sorted(
        zip(features, map(abs, clf.coef_[0].tolist())),
        key=lambda x: -x[1]
    )[:5],
}
print(json.dumps(model))
`;

  try {
    const escapedJson = trainJson.replace(/'/g, "'\\''");
    const output = execSync(
      `python3 -c '${pyScript.replace(/'/g, "'\\''")}' '${escapedJson}'`,
      {
        timeout: 60000,
        encoding: 'utf-8',
        maxBuffer: 5 * 1024 * 1024,
        env: { ...process.env, PYTHONPATH: '/home/jah/.local/lib/python3.12/site-packages' },
      }
    ).trim();

    const model = JSON.parse(output);
    fs.writeFileSync(MODEL_PATH, JSON.stringify(model, null, 2));

    console.log(`Verdict model saved: metrics/verdict-model.json`);
    console.log(`  CV accuracy: ${(model.cv_accuracy * 100).toFixed(1)}% on ${model.n_samples} samples`);
    const topFeats = model.feature_importance.map(([f, w]) => `${f}(${w.toFixed(3)})`).join(', ');
    console.log(`  Top features: ${topFeats}`);
  } catch (e) {
    console.log(`Verdict predictor training failed: ${e.message.slice(0, 120)}`);
  }
}

main();
