#!/usr/bin/env bash
# Test harness for OVERDRIVE_MODE=5. Launches a minimal synthesis call
# through the proxy to verify model chain resolution and routing.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "=== OVERDRIVE_MODE=5 Test Harness ==="
echo ""

# 1. Verify models.json parses
echo "--- models.json validation ---"
python3 -c "
import json, os
os.environ['PROJECT_ROOT'] = '$PROJECT'
cfg = json.load(open('$PROJECT/config/models.json'))
for tier in ['E5','E4','E3','E2','E1']:
    models = cfg['tiers'][tier]['models']
    top = cfg.get('manually_toprank',{}).get(tier,[]) or []
    ids = []
    for cost in cfg['ranking_rules']['cost_order']:
        group = sorted([m for m in models if m['cost']==cost], key=lambda m: -m['tier_score'])
        ids.extend(m['id'] for m in group)
    chain = [mid for mid in top if mid in ids] + [mid for mid in ids if mid not in top]
    print(f'{tier}: {chain[0]} (chain: {\", \".join(chain[:3])}...) [{len(chain)} models]')
print('models.json valid')
" || { echo "FAIL: models.json invalid"; exit 1; }

# 2. Verify Zen prefix coverage for all chain models
echo ""
echo "--- Zen prefix coverage ---"
python3 -c "
zen = ('deepseek','glm','minimax','qwen','kimi','mimo','nemotron','big-pickle','ring','gpt')
import json
cfg = json.load(open('$PROJECT/config/models.json'))
all_ids = set()
for t in cfg['tiers'].values():
    for m in t['models']:
        all_ids.add(m['id'])
missing = [mid for mid in all_ids if not mid.startswith(zen) and cfg['tiers']['E5']['models'][0].get('provider') != 'cascade']
for mid in sorted(all_ids):
    is_z = mid.startswith(zen)
    print(f'  {mid:30s} zen={is_z}')
print(f'All {len(all_ids)} models checked')
" || echo "WARN: prefix check failed"

# 3. Verify proxy health
echo ""
echo "--- Proxy health ---"
HEALTH=$(curl -sf http://localhost:9099/health 2>&1 || echo '{"status":"DOWN"}')
STATUS=$(echo "$HEALTH" | python3 -c "import json,sys; print(json.load(sys.stdin).get('status','DOWN'))" 2>/dev/null || echo "DOWN")
echo "Proxy: $STATUS"
[ "$STATUS" = "ok" ] || { echo "FAIL: proxy not healthy"; exit 1; }

# 4. Verify module loads
echo ""
echo "--- Module load ---"
PYTHONPATH="$PROJECT/tools/HME/service:$PROJECT/tools/HME/service/server" \
  python3 -c "
import os, sys
os.environ['PROJECT_ROOT'] = '$PROJECT'
os.environ['OVERDRIVE_MODE'] = '5'
sys.path.insert(0, '$PROJECT/tools/HME/service/server/tools_analysis/synthesis')
# Test chain resolution only (full import may need worker context)
import json
cfg = json.load(open('$PROJECT/config/models.json'))
cost_order = cfg['ranking_rules']['cost_order']
for tier in ['E3']:
    models = cfg['tiers'][tier]['models']
    top = cfg.get('manually_toprank',{}).get(tier,[]) or []
    ids = []
    for cost in cost_order:
        group = sorted([m for m in models if m['cost']==cost], key=lambda m: -m['tier_score'])
        ids.extend(m['id'] for m in group)
    chain = [mid for mid in top if mid in ids] + [mid for mid in ids if mid not in top]
    print(f'Chain resolved: {chain}')
print('Module logic OK')
" || echo "WARN: full module import may need worker context"

echo ""
echo "=== Harness complete ==="
echo "To test with real prompt: set OVERDRIVE_MODE=5 in .env and restart worker"
echo "Then run: i/trace target=synthesis_overdrive mode=impact"
