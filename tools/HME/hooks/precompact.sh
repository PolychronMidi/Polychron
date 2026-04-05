#!/usr/bin/env bash
# HME PreCompact: preserve critical context before compaction
cat > /dev/null  # consume stdin

cat >&2 <<'MSG'
CONTEXT COMPACTING: Before compaction completes, ensure you have:
(1) Saved any new calibration anchors or decisions to add_knowledge
(2) Noted any in-progress file paths and line numbers you'll need after compaction
(3) Committed or stashed any pending code changes
After compaction: use recent_changes to re-orient, search_knowledge to reload constraints.
MSG
exit 0
