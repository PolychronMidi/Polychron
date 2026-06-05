# Context Capsule: review round_measured.sh (the mesh review harness)

## artifact
teams/rounds/round_measured.sh -- the sequential, capsule-grounded review-round
runner: snapshots/restores the team dashboard, resets channels + per-role
sessions + dispatch budget, and dispatches BASELINE (one peer) then a MULTI-PEER
chain (red_lead -> red_purple -> blue_purple) through team_dispatch_guard.py.

## goal
Find decision-changing correctness/safety flaws in the HARNESS that would corrupt
results, leak state across runs, mis-restore the dashboard, or mis-bound the
round. Cite the block. ask-peer.sh and the guard are assumed correct here.

## constraints
Team policy: peers are driver forks with full inherited context and full tool
access; dispatch is strictly sequential (no fan-out). The harness writes only
under teams/ and tools/HME/runtime; it must leave the dashboard as it found it.
bash is set -uo pipefail (note: not -e). PROJECT_ROOT is required.

## rubric
Classify P0/P1/P2. For each: block, exact failure, one-line fix. Reject style
notes. Prefer state-leak, trap/cleanup, quoting, and race/ordering bugs.

## coverage
included: the full round_measured.sh source below -- PROJECT_ROOT handling, DASH
snapshot/restore trap, channel/session/budget reset, the gcap guard wrapper,
reply extraction, and the baseline + multi-peer dispatch sequence.
excluded: ask-peer.sh, team_dispatch_guard.py, team_agent_router.py.

## evidence
```bash
#!/usr/bin/env bash
# MEASURED grounded review round: BASELINE (one high-effort peer) vs MULTI-PEER
# (red_lead -> red_purple -> blue_purple cross-exam), both Context-Capsule-
set -uo pipefail
REPO="${PROJECT_ROOT}"; cd "$REPO"
OUT="$REPO/teams/runtime/output"; mkdir -p "$OUT"
DASH="$REPO/tools/HME/runtime/team-dashboard.json"; SNAP="$OUT/m.snap"
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
export HME_ASK_PEER_PROJECT_ROOT="$REPO" HME_TEAM_MAX_REPLY_BYTES=3000
rm -f "$REPO"/teams/runtime/*.session "$REPO"/tools/HME/runtime/team-dispatch-budget.json
for c in red blue purple; do printf '# %s channel\n' "$c" > "$REPO/teams/$c.md"; done
CAP="${CAPSULE:-$REPO/teams/capsules/guard.md}"; GUARD="$REPO/tools/HME/scripts/team_dispatch_guard.py"
DUR="${HME_TEAM_ROUND_MAX_DURATION:-600}"
gcap(){ # caller tier depth turnid chan msg out  (capsule-grounded guard send)
  PROJECT_ROOT="$REPO" timeout "$((DUR + 40))s" python3 "$GUARD" --caller "$1" --tier "$2" --depth "$3" --turn-id "$4" --budget 4 --max-live 30 \
    --scope "measured capsule review" --artifact "teams/$5.md" --max-duration "$DUR" --max-tools 8 \
    --capsule "$CAP" --send --message "$6" > "$OUT/$7" 2>>"$OUT/m.err"; }
reply(){ python3 -c "import json,sys;print(json.load(open('$OUT/$1')).get('reply',''))" 2>/dev/null; }

# === BASELINE: one high-effort peer, capsule-grounded (driver->blue_lead) ===
gcap driver E5 0 m-base blue "BASELINE single reviewer. Per the capsule rubric, list ALL decision-changing flaws (P0/P1) with function + fix. Cite capsule sections." m_base.json

# === MULTI-PEER, sequential ===
gcap driver E5 0 m-red red "RED LEAD attack. Per the capsule rubric, find the strongest decision-changing flaws (function + fix). Cite capsule sections; flag GAP or decline if absent." m_red.json
RED="$(reply m_red.json)"
gcap red_lead E4 1 m-redp red "RED PURPLE: sharpen red's findings; drop weak; add any red missed. Keep decision-changing only. Red said: $RED" m_redp.json
REDP="$(reply m_redp.json)"
gcap red_purple E4 1 m-cross purple "BLUE PURPLE cross-exam: which red findings are real P0/P1 vs false positives, and what did red MISS? Cite the capsule. Red purple set: $REDP" m_cross.json

echo "measured-done"
for f in m_base m_red m_redp m_cross; do printf '%s reply_bytes=%s\n' "$f" "$(reply $f.json | wc -c)"; done
```
