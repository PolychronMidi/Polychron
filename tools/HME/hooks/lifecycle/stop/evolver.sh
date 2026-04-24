# Evolver Loop (ralph-loop pattern)
# When .claude/hme-evolver.local.md exists, block exit and inject next iteration.
LOOP_FILE="$CLAUDE_PROJECT_DIR/.claude/hme-evolver.local.md"

if [[ -f "$LOOP_FILE" ]]; then
  # Parse frontmatter
  FM=$(sed -n '/^$/,/^$/{ /^$/d; p; }' "$LOOP_FILE")

  # `|| true` on each so set -euo pipefail doesn't kill the stop hook when
  # an optional frontmatter field is absent (grep returns 1 on no-match).
  ENABLED=$(echo "$FM" | grep '^enabled:' | sed 's/enabled: *//' || true)
  ITERATION=$(echo "$FM" | grep '^iteration:' | sed 's/iteration: *//' || true)
  MAX=$(echo "$FM" | grep '^max_iterations:' | sed 's/max_iterations: *//' || true)
  DONE_SIGNAL=$(echo "$FM" | grep '^done_signal:' | sed 's/done_signal: *//' | sed 's/^"\(.*\)"$/\1/' || true)

  # Skip if disabled
  if [[ "$ENABLED" != "true" ]]; then
    echo 'Evolver loop present but disabled.' >&2
  else
    ITERATION=${ITERATION:-1}
    MAX=${MAX:-0}

    # Check max iterations cap
    if [[ "$MAX" -gt 0 && "$ITERATION" -ge "$MAX" ]]; then
      echo "Evolver loop: max iterations ($MAX) reached. Removing loop file." >&2
      rm "$LOOP_FILE"
    else
      # Check transcript for done_signal
      TRANSCRIPT_PATH=$(_safe_jq "$INPUT" '.transcript_path' '')
      DONE=false
      if [[ -n "$DONE_SIGNAL" && -n "$TRANSCRIPT_PATH" && -f "$TRANSCRIPT_PATH" ]]; then
        if grep -q "$DONE_SIGNAL" "$TRANSCRIPT_PATH" 2>/dev/null; then
          DONE=true
        fi
      fi

      if [[ "$DONE" == "true" ]]; then
        echo "Evolver loop: done signal detected. Removing loop file." >&2
        rm "$LOOP_FILE"
      else
        # Extract prompt body (everything after second )
        NEXT_PROMPT=$(awk '/^$/{i++; next} i>=2' "$LOOP_FILE")

        # Increment iteration atomically
        NEXT_ITER=$((ITERATION + 1))
        TEMP="${LOOP_FILE}.tmp.$$"
        sed "s/^iteration: .*/iteration: $NEXT_ITER/" "$LOOP_FILE" > "$TEMP"
        mv "$TEMP" "$LOOP_FILE"

        # Block exit and inject next evolution prompt
        jq -n \
          --arg prompt "$NEXT_PROMPT" \
          --argjson iter "$NEXT_ITER" \
          --argjson max "$MAX" \
          '{
            "decision": "block",
            "reason": $prompt,
            "systemMessage": ("Evolver loop: iteration " + ($iter|tostring) + (if $max > 0 then "/" + ($max|tostring) else "" end))
          }'
        exit 0
      fi
    fi
  fi
fi
