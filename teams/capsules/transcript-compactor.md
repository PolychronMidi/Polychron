# Context Capsule: review the transcript compactor

## artifact
tools/HME/proxy/transcript_compactor.js -- shrinks Claude Code's append-only .jsonl
transcript below the ~30MB read limit. compactTranscriptLines never drops a line
(recent window + unparseable lines pass through byte-exact; only large tool_result/
toolUseResult/attachment values are elided to a marker). compactTranscriptFile is a
guarded atomic rewrite: no-op under highWater, escalation tiers if still over the
hard limit, and size+mtime rechecks before AND after the write to avoid clobbering
a concurrent Claude append. maybeCompactTranscriptFile is the best-effort entry.

## goal
Find decision-changing correctness/safety flaws: a path that DROPS or corrupts a
transcript line, an elision that changes the shape a later reader trusts, a
concurrent-write guard that can still clobber a live append, an escalation that
fails to get under the hard limit, or a rewrite that loses data on crash. Cite the
function + line.

## constraints
The transcript is Claude Code's own append-only file; the compactor must NEVER drop
a line or break JSONL framing, and must abort rather than clobber a concurrent
append. The recent-keep window must stay byte-exact (active task context). The
whole path is best-effort and must never throw out to the hook. Review only the
evidence below unless you verify a fact with tools.

## rubric
Classify P0/P1/P2 with the claim-audit discipline. For each: function/line, exact
failure, contradictory evidence (which existing guard/test may already cover it, or
"none found after checking"), and a one-line fix. Reject style notes. Prefer
line-drop/framing, concurrent-write race, escalation correctness, and shape bugs.

## coverage
included: full transcript_compactor.js source below -- _marker, _serializedBytes,
_elideValue, _elideToolResultContent, compactEntry, compactTranscriptLines,
compactTranscriptFile, and maybeCompactTranscriptFile.
excluded: the callers (the claude_adapter Stop/SessionStart/PostToolUse triggers)
and Claude Code's transcript read internals (assumed as documented constants here).

## evidence
Live source (read fresh at dispatch -- never a stale copy):
- tools/HME/proxy/transcript_compactor.js

