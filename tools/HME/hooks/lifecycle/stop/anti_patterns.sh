# Anti-pattern blockers — all consume verdict vars set by detectors.sh.
# Stage runs in a subshell now (see stop.sh subshell-isolation refactor),
# so vars no longer inherit from the parent. Source the persisted file.
_DETECTOR_VERDICTS_FILE="${PROJECT_ROOT:-/home/jah/Polychron}/tmp/hme-stop-detector-verdicts.env"
[ -f "$_DETECTOR_VERDICTS_FILE" ] && source "$_DETECTOR_VERDICTS_FILE"
POLL_COUNT="${POLL_COUNT:-0}"
IDLE_AFTER_BG="${IDLE_AFTER_BG:-ok}"
PSYCHO_STOP="${PSYCHO_STOP:-ok}"
ACK_SKIP="${ACK_SKIP:-ok}"
ABANDON_CHECK="${ABANDON_CHECK:-ok}"
FABRICATION_CHECK="${FABRICATION_CHECK:-ok}"
EARLY_STOP="${EARLY_STOP:-ok}"

# Background task polling detection
if [[ "$POLL_COUNT" -ge 2 ]]; then
  jq -n '{
    "decision": "block",
    "reason": "ANTI-POLLING: You polled pipeline/task status multiple times in one turn. This is the wait-and-poll antipattern. Background tasks fire notifications when done — use pipeline_digest (freshness guard) or do real work instead."
  }'
  exit 0
fi

# Background-launch-then-idle detection
if [[ "$IDLE_AFTER_BG" == "idle" ]]; then
  jq -n '{
    "decision": "block",
    "reason": "ANTI-IDLE: Pipeline is running in background — do NOT stop. Continue with real work now:\n1. Run index_codebase (KB stays fresh for next round)\n2. Pick next evolution targets from the suggest_evolution output and implement them\n3. Run what_did_i_forget on any recently changed files\n4. Update docs or KB entries for this round\nDo not end your turn until the pipeline completes or you have done 20+ tool calls of substantive work."
  }'
  exit 0
fi

# Fabrication detection — asserting quantitative pipeline invariants
# ("held steady", "stayed constant", "unchanged across runs") without
# the turn having read the artifact that would prove them. Origin: R36
# invented "total beats held steady" to justify a stochastic-gating
# hypothesis, when recent runs varied 781-1409 beats. The stiffarm.
if [[ "$FABRICATION_CHECK" == "fabrication" ]]; then
  jq -n '{
    "decision": "block",
    "reason": "FABRICATION DETECTED: final text asserts a quantitative invariant about pipeline state (\"held steady\", \"stayed constant\", \"unchanged across runs\", \"same as last\", etc.) without the turn containing a verification disclosure marker. In a stochastic music generator every run-level metric is different; invariance is the claim that needs proof, not the default. Choose one and resume: (a) VERIFY the claim now via i/status or Read output/metrics or grep run-history, then annotate the claim with \"(verified)\" / \"(confirmed)\"; (b) REMOVE the fabricated claim from the response; (c) EXPLICITLY qualify it with \"(unverified)\" / \"(assumed)\" / \"(did not check)\". Silent fabrication to bridge reasoning gaps is the antipattern this gate exists to block."
  }'
  exit 0
fi

# Psychopathic-stop detection
if [[ "$PSYCHO_STOP" == "psycho" ]]; then
  jq -n '{
    "decision": "block",
    "reason": "PSYCHOPATHIC-STOP: One of three defer-instead-of-do patterns fired: (A) launched a long background job + ScheduleWakeup; (B) admit-and-stop — final text enumerated pending work with no tool calls following; (C) survey-and-ask — final text identified violations/opportunities a directive already told you to fix, then asked permission instead of fixing (\"want me to run...\", \"did not modify\", \"before any edits\", \"shall I\"). The directive already granted authority. Resume and EXECUTE the work now. If the scope is genuinely ambiguous, clarify BEFORE surveying, not after."
  }'
  exit 0
fi

# Acknowledge-and-move-on detection
if [[ "$ACK_SKIP" == "ack_skip" ]]; then
  jq -n '{
    "decision": "block",
    "reason": "ACKNOWLEDGE-AND-MOVE-ON: HME surfaced a CRITICAL/FAIL this turn but you have not made any Edit/Write calls since. \"Noting\" a failure, \"flagging\" it, saving it for a sweep, or spawning an Agent to survey instead of fixing it is the antipattern the fix_antipattern wiring exists to block. Required action now: diagnose root cause, Edit the offending code, re-run the HME tool to verify the CRITICAL cleared. If the CRITICAL is from a long-running background process that will resolve itself, say so EXPLICITLY in text before stopping — but fix it if you can."
  }'
  exit 0
fi

# Plan-abandonment detection
if [[ "$ABANDON_CHECK" == "AGENT_FOR_KB" ]]; then
  jq -n '{
    "decision": "block",
    "reason": "PLAN-ABANDONMENT DETECTED: You spawned an Agent for KB/HME work. Use HME tools directly: search_knowledge, compact_knowledge, remove_knowledge, list_knowledge, memory_dream, kb_health. Subagents for KB work are the abandoning-plans antipattern (KB entry 524061657661). Complete the task using HME tools now."
  }'
  exit 0
fi

# Early-stop on open-ended HME rounds — the "anything missing? / do all"
# ceremony detector. Triggers when the user signalled continuous motion
# AND your final text enumerated remaining work AND no tool calls fired
# after that text. KB entry dae793e748f9 has the full rationale.
if [[ "$EARLY_STOP" == "early_stop" ]]; then
  jq -n '{
    "decision": "block",
    "reason": "EARLY-STOP DETECTED: This is an open-ended HME/chat/tooling round (\"do all\", \"anything missing\", \"keep going\", \"improve X\", \"push further\", or similar). Your final text enumerated remaining gaps but you stopped without executing through them. The user has explicitly asked you to skip the \"anything missing? / do all\" ceremony — KB entry dae793e748f9 documents the protocol. Continue NOW: pick the highest-leverage items from your enumerated list and land them in this same turn. Stop only when remaining items are genuinely low-leverage polish, require architectural decisions the user owns, or require machine access you don'"'"'t have. Narrow-scope user prompts (\"rename foo to bar\") explicitly override this — if you believe the user'"'"'s intent was bounded, say so explicitly in text and continue with what you can do within that bound."
  }'
  exit 0
fi
