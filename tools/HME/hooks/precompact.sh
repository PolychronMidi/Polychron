#!/usr/bin/env bash
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_safety.sh"
# HME PreCompact: surface pending KB anchors and tracked note files before compaction
cat > /dev/null  # consume stdin

PROJECT="${CLAUDE_PROJECT_DIR:-/home/jah/Polychron}"
TAB="$PROJECT/tmp/hme-tab.txt"
PARTS=()

if [[ -f "$TAB" && -s "$TAB" ]]; then
  # Pending KB anchors
  KB_LINES=$(grep '^KB:' "$TAB" 2>/dev/null)
  if [[ -n "$KB_LINES" ]]; then
    PARTS+=("PENDING KB ANCHORS — save with add_knowledge before compaction:")
    PARTS+=("$KB_LINES")
    PARTS+=("")
  fi

  # Tracked note files (from background tasks, writes, agents)
  FILE_LINES=$(grep '^FILE:' "$TAB" 2>/dev/null)
  if [[ -n "$FILE_LINES" ]]; then
    PARTS+=("TRACKED NOTE FILES — check these after compaction:")
    PARTS+=("$FILE_LINES")
    PARTS+=("")
  fi
fi

# Also scan project tmp/ for recent .md/.txt not already in the tab
FOUND=$(find "$PROJECT/tmp" -maxdepth 1 \( -name "*.md" -o -name "*.txt" \) -mmin -480 ! -name "hme-tab.txt" 2>/dev/null | sort)
if [[ -n "$FOUND" ]]; then
  # Filter out files already tracked in tab
  UNTRACKED=""
  while IFS= read -r f; do
    grep -qF "$f" "$TAB" 2>/dev/null || UNTRACKED+="  $f"$'\n'
  done <<< "$FOUND"
  if [[ -n "$UNTRACKED" ]]; then
    PARTS+=("UNTRACKED SESSION FILES in tmp/:")
    PARTS+=("$UNTRACKED")
  fi
fi

if [[ ${#PARTS[@]} -gt 0 ]]; then
  printf '%s\n' "${PARTS[@]}" >&2
fi
exit 0
