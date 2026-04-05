#!/usr/bin/env bash
# HME SessionStart: anticipatory orientation — read journal + git state + surface context
cat > /dev/null  # consume stdin

PROJECT="${CLAUDE_PROJECT_DIR:-/home/jah/Polychron}"

# Persist HME env vars for the session
if [ -n "$CLAUDE_ENV_FILE" ]; then
  echo "export HME_ACTIVE=1" >> "$CLAUDE_ENV_FILE"
fi

# Build orientation message
MSG=""

# Last journal round
JOURNAL="$PROJECT/metrics/journal.md"
if [ -f "$JOURNAL" ]; then
  LAST_ROUND=$(grep -m1 '^## R' "$JOURNAL" | head -1)
  if [ -n "$LAST_ROUND" ]; then
    MSG="$MSG\n$LAST_ROUND"
    # Grab next 3 non-empty lines for context
    CONTEXT=$(sed -n "/^## R/{n;n;p;n;p;n;p;}" "$JOURNAL" | head -3 | sed 's/^/  /')
    [ -n "$CONTEXT" ] && MSG="$MSG\n$CONTEXT"
  fi
fi

# Recent uncommitted changes
CHANGED=$(git -C "$PROJECT" diff --name-only 2>/dev/null | head -5)
STAGED=$(git -C "$PROJECT" diff --cached --name-only 2>/dev/null | head -5)
if [ -n "$CHANGED" ] || [ -n "$STAGED" ]; then
  MSG="$MSG\nPending changes:"
  [ -n "$CHANGED" ] && MSG="$MSG\n  modified: $(echo $CHANGED | tr '\n' ', ')"
  [ -n "$STAGED" ] && MSG="$MSG\n  staged: $(echo $STAGED | tr '\n' ', ')"
fi

# Fingerprint verdict from last run
FP="$PROJECT/metrics/fingerprint-comparison.json"
if [ -f "$FP" ]; then
  VERDICT=$(python3 -c "import json; print(json.load(open('$FP')).get('verdict','?'))" 2>/dev/null)
  [ -n "$VERDICT" ] && MSG="$MSG\nLast fingerprint: $VERDICT"
fi

echo -e "HyperMeta Ecstasy active. Load skill: /HME$MSG" >&2
exit 0
