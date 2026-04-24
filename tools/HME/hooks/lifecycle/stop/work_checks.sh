# Default enforcement reminder
echo 'STOP. Re-read CLAUDE.md and the user prompt. Did you do ALL the work asked? Every change must be implemented in code, including errors that surface along the way in other involved tools or code (in /src, /tools, or wherever the request is scoped), not just documented. If you skipped anything, go back and do it now.' >&2
# STOP_WORK was captured earlier via run_all.py.
if [[ "$STOP_WORK" == "DISMISSIVE" ]]; then
  jq -n '{
    "decision": "block",
    "reason": "STOP-WORK ANTIPATTERN: You responded with dismissive text instead of doing work. Re-read the user prompt and the conversation. There is always pending work after a user message — find it and do it. If genuinely nothing remains, explain what was completed and why."
  }'
  exit 0
fi
if [[ "$STOP_WORK" == "TEXT_ONLY_SHORT" ]]; then
  jq -n '{
    "decision": "block",
    "reason": "STOP-WORK ANTIPATTERN: Your last turn was a short text-only response with no tool calls. If there is remaining work, continue it now. If you genuinely completed everything, provide a substantive summary of what was done."
  }'
  exit 0
fi

# EXHAUST_CHECK: sister of early_stop but unconditional — matches any final
# text with a deferral phrase (substring OR structural regex) followed by
# ANY handoff marker (bullet, numbered, or bold-header paragraph) OR
# positioned in the closing 40% / last 400 chars of the message. The old
# "3+ bullets" threshold let single-item punts slip through — tightened
# after a `## Remaining X gap I didn't fix`-style evasion passed the gate.
# Verdict captured above in the run_all.py batch; here we just act on it.
if [[ "$EXHAUST_CHECK" == "exhaust_violation" ]]; then
  jq -n '{
    "decision": "block",
    "reason": "EXHAUST PROTOCOL VIOLATION: Final text enumerated remaining items (TBD/noted/remaining tools) without fixing them. Every enumerated item must be fixed in the same turn. Resume and implement the highest-leverage items now."
  }'
  exit 0
fi

# AUTO-COMPLETENESS INJECT — replaces the user's manual "what's missing? do
# all of it" follow-up with a hook-side injection. Fires at most twice per
# user-turn (first stop = initial inject asking what's missing; second stop
# if the agent still seems to be wrapping up = safety-net re-ask). After
# two injections the turn is allowed to end regardless — the user can still
# redirect explicitly if they disagree.
#
# Turn identity = sha256(last user message content). Stable across all
# stops of a given turn, changes the moment the user sends a new prompt.
# Stored in tmp/hme-completeness-injected/<hash> with the count so far.
#
# This is NOT a classifier — it doesn't read the agent's text or try to
# detect deferral phrasings (exhaust_check already does keyword-level
# detection). It's a UNCONDITIONAL auto-prompt replacing manual typing.
# The agent is always asked "what's missing?" once, regardless of how
# complete the response looks. If nothing's missing, responding
# 'Nothing missed' ends the loop at the next stop.
_COMPL_DIR="${PROJECT_ROOT:-/home/jah/Polychron}/tmp/hme-completeness-injected"
mkdir -p "$_COMPL_DIR"
_COMPL_TRANSCRIPT=$(_safe_jq "$INPUT" '.transcript_path' '')
_COMPL_MAX=2
if [ -n "$_COMPL_TRANSCRIPT" ] && [ -f "$_COMPL_TRANSCRIPT" ]; then
  # Extract the last REAL user prompt (not a tool_result message). User
  # prompts have content as a string OR an array of {type:"text"} blocks;
  # tool_result "user" messages have array with {type:"tool_result"}
  # blocks. Filter for text-only content so our turn-key tracks the
  # user's actual prompt, not post-tool plumbing.
  _COMPL_LAST_USER=$(jq -r '
    select((.type // .role) == "user")
    | (.message.content // .content)
    | if type == "string" then .
      elif type == "array" then ([.[] | select(.type == "text") | .text] | join(" "))
      else ""
      end
  ' "$_COMPL_TRANSCRIPT" 2>/dev/null | grep -v '^$' | tail -1)
  _COMPL_TURN_KEY=$(printf '%s' "$_COMPL_LAST_USER" | sha256sum | head -c 16)
  if [ -n "$_COMPL_TURN_KEY" ]; then
    _COMPL_FLAG="$_COMPL_DIR/$_COMPL_TURN_KEY"
    _COMPL_COUNT=0
    [ -f "$_COMPL_FLAG" ] && _COMPL_COUNT=$(cat "$_COMPL_FLAG" 2>/dev/null || echo 0)
    case "$_COMPL_COUNT" in ''|*[!0-9]*) _COMPL_COUNT=0 ;; esac
    if [ "$_COMPL_COUNT" -lt "$_COMPL_MAX" ]; then
      _COMPL_NEXT=$((_COMPL_COUNT + 1))
      echo "$_COMPL_NEXT" > "$_COMPL_FLAG"
      # Prune old flags to keep the directory small (retain last 50 turns).
      (cd "$_COMPL_DIR" && ls -1t | tail -n +51 | xargs -r rm -f) 2>/dev/null || true
      # Distinct prompts per round so the model treats the second as a
      # genuine safety-net rather than a repeat of round 1.
      if [ "$_COMPL_NEXT" = "1" ]; then
        _COMPL_REASON="AUTO-COMPLETENESS INJECT (round 1/2): Before stopping, enumerate everything that might still be missing, unfinished, deferred, flagged, a possible gap, or worth doing relative to THIS TURN'\''s work. Then do ALL of it — no deferrals, no flagging, no punts. If truly nothing remains, state '\''Nothing missed'\'' explicitly. This is the auto-injected version of the user'\''s usual '\''what'\''s missing? do all'\'' follow-up."
      else
        _COMPL_REASON="AUTO-COMPLETENESS INJECT (round 2/2 — safety net): Last chance to catch unfinished or skipped work before the turn ends. If you claimed '\''Nothing missed'\'' in the last response, are you SURE nothing else is worth doing? Anything you'\''d normally flag as '\''could be followed up'\'' or '\''worth investigating separately'\'' — do it now. If confirmed nothing remains, say so plainly and the turn will end."
      fi
      jq -n --arg reason "$_COMPL_REASON" '{"decision":"block","reason":$reason}'
      exit 0
    fi
  fi
fi
