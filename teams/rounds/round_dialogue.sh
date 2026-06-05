#!/usr/bin/env bash
# MULTI-STEP dialogue round: red vs blue debate a real open design question over
# MULTIPLE turns (each peer RESUMES its own session -> remembers prior turns),
set -uo pipefail
REPO="${PROJECT_ROOT}"; cd "$REPO"
OUT="$REPO/teams/runtime/output"; mkdir -p "$OUT"
DASH="$REPO/tools/HME/runtime/team-dashboard.json"; SNAP="$OUT/dlg.snap"
if [ -f "$DASH" ]; then cp "$DASH" "$SNAP"; else echo MISSING > "$SNAP"; fi
cleanup(){ if [ -f "$SNAP" ] && ! grep -qx MISSING "$SNAP"; then cp "$SNAP" "$DASH"; else rm -f "$DASH"; fi; }
trap cleanup EXIT
cat > "$DASH" <<'JSON'
{"agents":{"driver":{"role":"driver","status":"registered","tier":"E5","ctx_used_pct":5},
"red_lead":{"role":"red_lead","status":"registered","tier":"E5","ctx_used_pct":8},
"blue_lead":{"role":"blue_lead","status":"registered","tier":"E5","ctx_used_pct":10},
"red_purple":{"role":"red_purple","status":"registered","tier":"E4","ctx_used_pct":18},
"blue_purple":{"role":"blue_purple","status":"registered","tier":"E4","ctx_used_pct":22}}}
JSON
export HME_ASK_PEER_PROJECT_ROOT="$REPO" HME_TEAM_MAX_REPLY_BYTES=2600
# Multi-turn debate: peers RESUME their own forked thread so they remember prior turns.
export HME_TEAM_RESUME_PEER_SESSIONS=1
rm -f "$REPO"/teams/runtime/*.session "$REPO"/tools/HME/runtime/team-dispatch-budget.json
for c in red blue purple; do printf '# %s channel\n' "$c" > "$REPO/teams/$c.md"; done
CTX="${CTX:-$REPO/teams/capsules/ctx_design.md}"
ASK="$REPO/tools/HME/scripts/ask-peer.sh"; GUARD="$REPO/tools/HME/scripts/team_dispatch_guard.py"

# ROUND 1 -- opening positions (forked peers with full context, grounded by the context f
timeout 200s "$ASK" red_lead "$(cat "$CTX")

RED LEAD position: argue the STRONGEST case for option A (distinct fresh agents) as default. Decision-changing only, <=1000 chars." > "$OUT/d1_red.txt" 2>>"$OUT/dlg.err"
timeout 200s "$ASK" blue_lead "$(cat "$CTX")

BLUE LEAD position: argue the STRONGEST case for option B (driver fork) as default. Decision-changing only, <=1000 chars." > "$OUT/d1_blue.txt" 2>>"$OUT/dlg.err"

# ROUND 2 -- rebuttals (each RESUMES its own session, so it remembers its opening)
timeout 200s "$ASK" red_lead "Blue argued FOR driver-fork: $(cat "$OUT/d1_blue.txt")
Rebut blue and refine YOUR recommendation. Concede any real point. <=900 chars." > "$OUT/d2_red.txt" 2>>"$OUT/dlg.err"
timeout 200s "$ASK" blue_lead "Red argued FOR fresh agents: $(cat "$OUT/d1_red.txt")
Rebut red and refine YOUR recommendation. Concede any real point. <=900 chars." > "$OUT/d2_blue.txt" 2>>"$OUT/dlg.err"

# ROUND 3 -- purple synthesis, grounded by the full exchange (uses --context-file)
{ echo "RED opening:"; cat "$OUT/d1_red.txt"; echo; echo "BLUE opening:"; cat "$OUT/d1_blue.txt";
  echo; echo "RED rebuttal:"; cat "$OUT/d2_red.txt"; echo; echo "BLUE rebuttal:"; cat "$OUT/d2_blue.txt"; } > "$OUT/exchange.txt"
PROJECT_ROOT="$REPO" timeout 200s python3 "$GUARD" --caller red_purple --tier E4 --depth 1 --turn-id dlg-syn --budget 4 --max-live 30 \
  --scope "design synthesis" --artifact "teams/purple.md" --max-duration 180 --max-tools 2 \
  --context-file "$OUT/exchange.txt" --send \
  --message "Synthesize the red/blue debate. Give the FINAL decision-changing answers to the 3 questions: default model + when to use the other; the ONE missing mechanism to beat a single high-effort peer; hybrid worth it or trap. <=1200 chars." > "$OUT/d3_purple.json" 2>>"$OUT/dlg.err"

echo "dialogue-done"
for f in d1_red d1_blue d2_red d2_blue; do printf '%s=%s bytes\n' "$f" "$(wc -c < "$OUT/$f.txt")"; done
python3 -c "import json;print('purple_synth_bytes=',len(json.load(open('$OUT/d3_purple.json')).get('reply','')))" 2>/dev/null
