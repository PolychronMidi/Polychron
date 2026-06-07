#!/usr/bin/env bash
# MEASURED grounded review round: BASELINE (one high-effort peer) vs MULTI-PEER
# (red_lead -> red_purple -> blue_purple cross-exam), both Context-Capsule-
set -uo pipefail
REPO="${PROJECT_ROOT}"; cd "$REPO"
OUT="$REPO/teams/runtime/output"; mkdir -p "$OUT"
source "$REPO/teams/rounds/_progress.sh"
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
CAP=""
cleanup(){
  if [ "$HAD_DASH" = "1" ]; then
    if ! cp "$SNAP" "$DASH"; then echo "WARN: failed to restore $DASH from $SNAP" >&2; fi
  else
    rm -f "$DASH"
  fi
  rm -f "$SNAP" ${CAP:+"$CAP"}
}
trap cleanup EXIT
cat > "$DASH" <<'JSON'
{"agents":{"driver":{"role":"driver","status":"registered","tier":"E5","ctx_used_pct":5},
"red_lead":{"role":"red_lead","status":"registered","tier":"E5","ctx_used_pct":8},
"blue_lead":{"role":"blue_lead","status":"registered","tier":"E5","ctx_used_pct":10},
"red_purple":{"role":"red_purple","status":"registered","tier":"E4","ctx_used_pct":18},
"blue_purple":{"role":"blue_purple","status":"registered","tier":"E4","ctx_used_pct":22}}}
JSON
# Mesh-found P1 (red_purple+blue_purple): this round CHAINS each peer reply into
# the next peer's prompt (RED -> red_purple -> blue_purple cross-exam). A small
# reply cap truncated the handoff ("[truncated: peer reply exceeded byte cap]"),
export HME_ASK_PEER_PROJECT_ROOT="$REPO" HME_TEAM_MAX_REPLY_BYTES="${HME_TEAM_MAX_REPLY_BYTES:-12000}"
rm -f "$REPO"/tools/HME/runtime/team-dispatch-budget.json
# Preserve canonical team channels/session files. Rounds append through ask-peer;
# ask-peer's tail-cap bounds channel size without destroying live dialogue history.
for c in red blue purple; do [ -s "$REPO/teams/$c.md" ] || printf '# %s channel\n' "$c" > "$REPO/teams/$c.md"; done
GUARD="$REPO/tools/HME/scripts/team_dispatch_guard.py"
# Compose the per-surface review brief (DATA in teams/rounds/review-briefs.json)
# into a transient grounded review-request capsule that the guard sends as the
BRIEF="${BRIEF:-}"
[ -z "$BRIEF" ] && [ -n "${CAPSULE:-}" ] && BRIEF="$(basename "${CAPSULE%.md}")"  # back-compat: CAPSULE=<key|path>
BRIEF="${BRIEF:-guard}"
CAP="$(mktemp "$OUT/brief.XXXXXX.md")"
if ! PROJECT_ROOT="$REPO" python3 "$REPO/teams/rounds/review_brief.py" compose "$BRIEF" --out "$CAP" >/dev/null; then
  echo "review_brief compose failed for brief '$BRIEF'" >&2; exit 1
fi
DUR="${HME_TEAM_ROUND_MAX_DURATION:-600}"
# Mesh-found P2 (#28): derive the dispatch context cap from review_brief's lint
# cap (single source of truth) so a brief that lints OK can never be truncated by
CTX_CAP="${HME_TEAM_CONTEXT_CAP:-$(PROJECT_ROOT="$REPO" python3 -c 'import sys; sys.path.insert(0, "'"$REPO"'/teams/rounds"); import review_brief; print(review_brief._CAP)' 2>/dev/null || echo 300000)}"
# Opt-in: CLAIM_AUDIT=1 enables the calibrated claim-audit addendum for this
# high-impact round (structured finding record + contradictory-evidence +
CA_FLAG=""; [ "${CLAIM_AUDIT:-0}" = "1" ] && CA_FLAG="--claim-audit"
reply(){ python3 -c "import json,sys;print(json.load(open('$OUT/$1')).get('reply',''))" 2>/dev/null; }
gcap(){ # caller tier depth turnid chan target msg out  (capsule-grounded guard send)
  local send_dur="${HME_MESH_ACTIVE_MAX_DURATION:-$DUR}" max_tools="${HME_MESH_ACTIVE_MAX_TOOLS:-8}"
  # Report BEFORE dispatch (so a stuck/killed peer is visible as 'dispatching'),
  # capture the reply to its own file immediately, then report done/failed with
  progress_result "$8" dispatching "$6" "" "" "" "$1 -> $6 via teams/$5.md"
  PROJECT_ROOT="$REPO" timeout "$((send_dur + 40))s" python3 "$GUARD" --caller "$1" --tier "$2" --depth "$3" --turn-id "$4" --budget 4 --max-live 30 \
    --scope "measured capsule review" --artifact "teams/$5.md" --max-duration "$send_dur" --max-tools "$max_tools" \
    --target "$6" --context-cap "$CTX_CAP" --capsule "$CAP" $CA_FLAG --send --message "$7" > "$OUT/$8" 2>>"$OUT/m.err"
  local rc=$?
  local bytes; bytes="$(reply "$8" | wc -c | tr -d ' ')"
  if [ "$rc" = 0 ] && [ "${bytes:-0}" -gt 2 ]; then progress_result "$8" done "$6" "$rc" "$bytes" "" "reply captured"; else progress_result "$8" failed "$6" "$rc" "$bytes" "teams/runtime/output/m.err" "dispatch failed"; fi
  return 0
}
# Harness fix (mesh-found P1): neutralize structural markers (## headings, GAP:)
# in a prior peer's reply before embedding it in the NEXT peer's --message, so a
san(){ sed -E 's/^#{1,6} /  /; s/^GAP:/gap:/' ; }
DEPTH_CONTRACT="$(PROJECT_ROOT="$REPO" python3 "$REPO/teams/rounds/depth_decision.py" --emit-prompt-contract 2>/dev/null || true)"

progress_init "measured:$BRIEF" 4

# === BASELINE: one high-effort peer, capsule-grounded (driver->blue_lead) ===
# Mesh-found P1 (base+red): driver->lead turns route to teams/driver.md per
# roles.json (no channel_by_caller.driver override), so the ledger/leash channel
gcap driver E5 0 m-base driver blue_lead "BASELINE single reviewer. Per the capsule rubric, list ALL decision-changing flaws (P0/P1) with function + fix. Cite capsule sections." m_base.json

# === MULTI-PEER, sequential ===
gcap driver E5 0 m-red driver red_lead "RED LEAD attack. Per the capsule rubric, find the strongest decision-changing flaws (function + fix). Cite capsule sections; flag GAP or decline if absent." m_red.json
RED="$(reply m_red.json | san)"
gcap red_lead E4 1 m-redp red red_purple "RED PURPLE: sharpen red's findings; drop weak; add any red missed. Keep decision-changing only. Red said (quoted, markers neutralized): $RED" m_redp.json
REDP="$(reply m_redp.json | san)"
gcap red_purple E4 1 m-cross purple blue_purple "BLUE PURPLE cross-exam: which red findings are real P0/P1 vs false positives, and what did red MISS? Cite the capsule. Red purple set (quoted, markers neutralized): $REDP" m_cross.json

progress_round_finish "all 4 steps dispatched"
echo "measured-done"
for f in m_base m_red m_redp m_cross; do printf '%s reply_bytes=%s\n' "$f" "$(reply $f.json | wc -c)"; done
