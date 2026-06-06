#!/usr/bin/env bash
# MEASURED grounded review round: BASELINE (one high-effort peer) vs MULTI-PEER
# (red_lead -> red_purple -> blue_purple cross-exam), both Context-Capsule-
set -uo pipefail
REPO="${PROJECT_ROOT}"; cd "$REPO"
OUT="$REPO/teams/runtime/output"; mkdir -p "$OUT"
# Harness fix (mesh-found P1): clear prior round results so a timed-out/failed
# dispatch can't leave a STALE m_*.json that reply()/the summary reads as current.
rm -f "$OUT"/m_*.json "$OUT"/m.err
# Sweep stale per-call temps that a SIGKILL'd peer (EXIT trap skipped) may leak.
rm -f "$OUT"/../raw-cap.* "$OUT"/../raw-trunc.* "$OUT"/../reply.* "$OUT"/../sid.* 2>/dev/null
rm -rf "$OUT"/../raw-fifo.* 2>/dev/null
DASH="$REPO/tools/HME/runtime/team-dashboard.json"
# Harness fix (mesh-found P1): per-run snapshot path + an out-of-band presence
# flag (NOT an in-band MISSING sentinel that a real dashboard could collide with),
SNAP="$(mktemp "$OUT/m.snap.XXXXXX")"
HAD_DASH=0
if [ -f "$DASH" ]; then HAD_DASH=1; cp "$DASH" "$SNAP"; fi
cleanup(){
  if [ "$HAD_DASH" = "1" ]; then
    if ! cp "$SNAP" "$DASH"; then echo "WARN: failed to restore $DASH from $SNAP" >&2; fi
  else
    rm -f "$DASH"
  fi
  rm -f "$SNAP"
}
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
# Opt-in: CLAIM_AUDIT=1 enables the calibrated claim-audit addendum for this
# high-impact round (structured finding record + contradictory-evidence +
CA_FLAG=""; [ "${CLAIM_AUDIT:-0}" = "1" ] && CA_FLAG="--claim-audit"
gcap(){ # caller tier depth turnid chan msg out  (capsule-grounded guard send)
  PROJECT_ROOT="$REPO" timeout "$((DUR + 40))s" python3 "$GUARD" --caller "$1" --tier "$2" --depth "$3" --turn-id "$4" --budget 4 --max-live 30 \
    --scope "measured capsule review" --artifact "teams/$5.md" --max-duration "$DUR" --max-tools 8 \
    --capsule "$CAP" $CA_FLAG --send --message "$6" > "$OUT/$7" 2>>"$OUT/m.err"; }
reply(){ python3 -c "import json,sys;print(json.load(open('$OUT/$1')).get('reply',''))" 2>/dev/null; }
# Harness fix (mesh-found P1): neutralize structural markers (## headings, GAP:)
# in a prior peer's reply before embedding it in the NEXT peer's --message, so a
san(){ sed -E 's/^#{1,6} /  /; s/^GAP:/gap:/' ; }

# === BASELINE: one high-effort peer, capsule-grounded (driver->blue_lead) ===
gcap driver E5 0 m-base blue "BASELINE single reviewer. Per the capsule rubric, list ALL decision-changing flaws (P0/P1) with function + fix. Cite capsule sections." m_base.json

# === MULTI-PEER, sequential ===
gcap driver E5 0 m-red red "RED LEAD attack. Per the capsule rubric, find the strongest decision-changing flaws (function + fix). Cite capsule sections; flag GAP or decline if absent." m_red.json
RED="$(reply m_red.json | san)"
gcap red_lead E4 1 m-redp red "RED PURPLE: sharpen red's findings; drop weak; add any red missed. Keep decision-changing only. Red said (quoted, markers neutralized): $RED" m_redp.json
REDP="$(reply m_redp.json | san)"
gcap red_purple E4 1 m-cross purple "BLUE PURPLE cross-exam: which red findings are real P0/P1 vs false positives, and what did red MISS? Cite the capsule. Red purple set (quoted, markers neutralized): $REDP" m_cross.json

echo "measured-done"
for f in m_base m_red m_redp m_cross; do printf '%s reply_bytes=%s\n' "$f" "$(reply $f.json | wc -c)"; done
