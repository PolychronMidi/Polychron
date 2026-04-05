'use strict';
// Post-render perceptual analysis: runs EnCodec + CLAP on combined.wav,
// correlates with trace data, produces metrics/perceptual-report.json.
// Usage: node scripts/pipeline/perceptual-analysis.js
// Runs after npm run render. Skips if WAV is stale.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PROJECT_ROOT = path.join(__dirname, '..', '..');
const WAV_PATH = path.join(PROJECT_ROOT, 'output', 'combined.wav');
const TRACE_SUMMARY = path.join(PROJECT_ROOT, 'metrics', 'trace-summary.json');
const REPORT_PATH = path.join(PROJECT_ROOT, 'metrics', 'perceptual-report.json');

function main() {
  if (!fs.existsSync(WAV_PATH)) {
    console.log('No combined.wav -- run `npm run render` first.');
    return;
  }
  if (!fs.existsSync(TRACE_SUMMARY)) {
    console.log('No trace-summary.json -- run `npm run main` first.');
    return;
  }

  // Check freshness
  const wavTime = fs.statSync(WAV_PATH).mtimeMs;
  const traceTime = fs.statSync(TRACE_SUMMARY).mtimeMs;
  if (wavTime < traceTime - 600000) {
    console.log('combined.wav is stale (older than trace-summary). Run `npm run render` first.');
    return;
  }

  console.log('Running perceptual analysis...');

  const pyScript = `
import json, sys, os
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '3'
import warnings
warnings.filterwarnings('ignore')

import torch, torchaudio, numpy as np, librosa

# --- Phase 2: EnCodec ---
from encodec import EncodecModel
from encodec.utils import convert_audio

device = 'cuda' if torch.cuda.is_available() else 'cpu'
model = EncodecModel.encodec_model_24khz()
model.set_target_bandwidth(6.0)
model.to(device).eval()

wav, sr = torchaudio.load(sys.argv[1])
wav = convert_audio(wav, sr, model.sample_rate, model.channels).unsqueeze(0).to(device)
codes_list = []
with torch.no_grad():
    for s in range(0, wav.shape[-1], model.sample_rate * 30):
        c = wav[..., s:s + model.sample_rate * 30]
        if c.shape[-1] < model.sample_rate: continue
        codes_list.append(model.encode(c)[0][0][0].cpu())
codes = torch.cat(codes_list, dim=-1)
n_cb, n_frames = codes.shape
fps = n_frames / (wav.shape[-1] / model.sample_rate)

# Per-section entropy
section_times = {}
section_tensions = {}
with open(sys.argv[2]) as f:
    for line in f:
        try: rec = json.loads(line)
        except: continue
        bk = rec.get('beatKey',''); p = bk.split(':')
        sec = int(p[0]) if p and p[0].isdigit() else -1
        t = rec.get('timeMs',0)
        snap = rec.get('snap',{})
        tension = snap.get('tension',0) if isinstance(snap,dict) else 0
        if sec >= 0:
            if sec not in section_times:
                section_times[sec] = {'start':t/1000,'end':t/1000}
                section_tensions[sec] = []
            section_times[sec]['end'] = t/1000
            if isinstance(tension,(int,float)):
                section_tensions[sec].append(tension)

encodec_sections = {}
for sec in sorted(section_times):
    st = section_times[sec]
    f0 = int(st['start']*fps); f1 = min(int(st['end']*fps), n_frames)
    if f1 <= f0: continue
    entropies = {}
    for cb in range(min(n_cb, 4)):
        tok = codes[cb, f0:f1].numpy()
        u, c = np.unique(tok, return_counts=True)
        p = c/c.sum()
        entropies[f'cb{cb}'] = float(-np.sum(p*np.log2(p+1e-10)))
    avg_tension = sum(section_tensions.get(sec,[])) / max(len(section_tensions.get(sec,[])),1)
    encodec_sections[str(sec)] = {'entropies': entropies, 'tension': avg_tension}

# Correlation
tensions = [encodec_sections[s]['tension'] for s in sorted(encodec_sections)]
cb0_ents = [encodec_sections[s]['entropies']['cb0'] for s in sorted(encodec_sections)]
corr = float(np.corrcoef(tensions, cb0_ents)[0,1]) if len(tensions) > 2 else 0

# --- Phase 3: CLAP ---
del model, wav, codes  # free GPU
torch.cuda.empty_cache()

import laion_clap
clap = laion_clap.CLAP_Module(enable_fusion=False, amodel='HTSAT-tiny')
clap.load_ckpt()

queries = [
    'high musical tension building to climax',
    'relaxed atmospheric ambient texture',
    'rhythmically complex polyrhythmic pattern',
    'sparse minimal quiet passage',
    'dense chaotic many notes simultaneously',
    'coherent organized harmonic structure',
]

y, csr = librosa.load(sys.argv[1], sr=48000, mono=True)
chunk_sec = 10
chunks = [y[i:i+chunk_sec*csr] for i in range(0, len(y), chunk_sec*csr) if len(y[i:i+chunk_sec*csr]) >= csr*3]

text_embed = clap.get_text_embedding(queries, use_tensor=True)
audio_embeds = []
for chunk in chunks:
    ct = torch.from_numpy(chunk).float().unsqueeze(0)
    embed = clap.get_audio_embedding_from_data(ct, use_tensor=True)
    audio_embeds.append(embed)
audio_embed = torch.cat(audio_embeds, dim=0)
sim = torch.nn.functional.cosine_similarity(
    text_embed.unsqueeze(1), audio_embed.unsqueeze(0), dim=2
)

clap_results = {}
for qi, query in enumerate(queries):
    scores = sim[qi].detach().cpu().numpy()
    clap_results[query] = {
        'peak': float(np.max(scores)),
        'peak_time': int(np.argmax(scores)) * chunk_sec,
        'avg': float(np.mean(scores)),
    }

avg_q = sim.mean(dim=1).detach().cpu().numpy()
dominant = queries[int(np.argmax(avg_q))]

report = {
    'timestamp': __import__('datetime').datetime.now().isoformat(),
    'confidence': 0.15,
    'encodec': {
        'codebooks': int(n_cb),
        'total_frames': int(n_frames),
        'sections': encodec_sections,
        'tension_complexity_correlation': corr,
    },
    'clap': {
        'queries': clap_results,
        'dominant_character': dominant,
        'dominant_score': float(avg_q.max()),
        'chunks': len(chunks),
    },
}
print(json.dumps(report))
`;

  try {
    const output = execSync(
      `python3 -c '${pyScript.replace(/'/g, "'\\''").replace(/\n/g, '\n')}' '${WAV_PATH}' '${path.join(PROJECT_ROOT, 'metrics', 'trace.jsonl')}'`,
      {
        timeout: 300000,
        encoding: 'utf-8',
        maxBuffer: 50 * 1024 * 1024,
        env: { ...process.env, PYTHONPATH: '/home/jah/.local/lib/python3.12/site-packages' },
      }
    ).trim();

    // Extract JSON from output (skip model loading messages)
    const jsonStart = output.lastIndexOf('{');
    const jsonStr = output.slice(jsonStart);
    const report = JSON.parse(jsonStr);

    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));

    console.log(`Perceptual report saved: metrics/perceptual-report.json`);
    console.log(`  EnCodec: tension?unknown-ascii-character?complexity r=${report.encodec.tension_complexity_correlation.toFixed(3)}`);
    console.log(`  CLAP dominant: "${report.clap.dominant_character}" (${report.clap.dominant_score.toFixed(3)})`);
    console.log(`  Confidence: ${report.confidence * 100}%`);
  } catch (e) {
    console.log(`Perceptual analysis failed: ${e.message.slice(0, 120)}`);
  }
}

main();
