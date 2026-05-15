"""Shared phrase vocabularies for the detector chain.

Peer-review iter 135 found that ~9 detectors in the chain measure the
same underlying signal -- "agent verbal-stopped without doing the
work" -- using overlapping but subtly different phrase lists. Concrete
examples surfaced:

  - psycho_stop.ADMIT_PHRASES (~20 phrases)
  - exhaust_check.DEFERRAL_PHRASES (~110 phrases)
  - early_stop (paired with exhaust_check, same phrases)
  - stop_work, ack_skip, abandon_check, fabrication_check (similar)

The phrase lists shared ~40% of their vocabulary but had no shared
source. Adding "noted" to one detector but not the other shifted
detector behavior asymmetrically. This module is the consolidation
point for phrases that belong to a SHARED signal -- currently the
deferral / verbal-stop class. New detectors measuring this signal
must import from here; existing detectors are migrated incrementally
to avoid behavior regression.

The categories are designed to be SUBSETS, not overlapping:

  - DEFERRAL_FUTURE_TENSE: "will do X next session", "next turn",
    "follow-up task" -- schedules work for later.
  - DEFERRAL_FLAG_FOR_LATER: "flagging for later", "deferred to",
    "out of scope for this session" -- explicit deferral.
  - DEFERRAL_ACK_NO_FIX: "noted", "acknowledged", "I'll keep in mind"
    without follow-through -- verbal acknowledgment without action.
  - SURVEY_PERMISSION_ASK: "want me to", "shall I", "should I X" --
    soliciting permission instead of acting.

Use as appropriate to the detector's scope. Importing the union as
ALL_DEFERRAL gives equivalent coverage to the legacy
exhaust_check.DEFERRAL_PHRASES list.
"""
from __future__ import annotations


# Future-tense: agent commits work to a later turn rather than doing now.
DEFERRAL_FUTURE_TENSE: tuple[str, ...] = (
    "will activate on next",
    "will pick up on next",
    "activates on next session",
    "activates on next restart",
    "will happen on next",
    "next session",
    "on next session",
    "follow-up task",
    "followup task",
    "for a future turn",
    "in a future turn",
    "later this session",
    "in a later turn",
)

# Explicit deferral flags.
DEFERRAL_FLAG_FOR_LATER: tuple[str, ...] = (
    "flagging for later",
    "flag for later",
    "deferred to",
    "deferring",
    "out of scope for this session",
    "not in scope for this session",
    "won't do",
    "wont do",
    "skipping for now",
    "will skip",
    "built but not wired",
    "ready but not wired",
    "shipped but not wired",
    "built but not yet wired",
    "designed but not implemented",
    "designed for ... never edited",
    "ready but unused",
    "lurking observation-only",
    "observation-only gaps",
    "remains uninvestigated",
    "remains unfixed",
    "remains unused",
)

# Ack-without-fix.
DEFERRAL_ACK_NO_FIX: tuple[str, ...] = (
    "pending work",
    "still pending",
    "remaining work",
    "still need to",
    "still not fixed",
    "still unfixed",
    "noted but not fixed",
    "noted, not fixed",
    "noted but didn't",
    "did not modify",
    "didn't modify",
    "haven't modified",
    "not yet modified",
    "not yet fixed",
    "not yet applied",
    "i didn't touch",
    "i didn't edit",
    "surveyed, not modified",
    "surveyed but not modified",
    "surveyed, not fixed",
    "investigated but not fixed",
    "traced but not fixed",
    "diagnosed but not fixed",
    "half-done",
    "half done:",
    "halfway done",
    "partially done",
    "partially complete",
    "not yet wired",
    "never wired",
    "isn't yet wired",
    "remains uninvestigated",
    "investigated but never reported",
    "discovered but not addressed",
    "found but not fixed",
)

# Permission-soliciting (Pattern C in psycho_stop terminology).
SURVEY_PERMISSION_ASK: tuple[str, ...] = (
    "want me to",
    "would you like me to",
    "do you want me to",
    "should i fix",
    "should i proceed",
    "should i run",
    "should i start",
    "shall i",
    "before any edits",
    "before i make any edits",
    "before i start editing",
    "before i begin",
    "before i touch",
    "survey more files before",
    "survey first",
    "want me to continue",
    "want me to keep going",
    "confirm before",
    "confirm first",
    "if picking one",
    "if picking just one",
    "picking one to ship",
    "if you'd like",
    "if you want me",
    "the smallest item",
    "want me to ship",
)

# Mid-turn-abort phrases (cant-do-from-within class).
DEFERRAL_CANT_DO: tuple[str, ...] = (
    "can't do from within",
    "cant do from within",
    "can't do mid-turn",
    "cant do mid-turn",
    "session-level",
    "session level",
)

FORWARD_ACTION_PUNT_PHRASES: tuple[str, ...] = (
    "still to wire",
    "still to investigate",
    "still to implement",
    "still to surface",
    "still to address",
    "remains to wire",
    "remains to be wired",
    "remains to investigate",
    "remains to be investigated",
    "remains to be addressed",
    "remains to surface",
    "left to wire",
    "left to investigate",
    "left to surface",
    "left to implement",
    "pending investigation",
    "pending wiring",
    "pending implementation",
    "needs to be wired",
    "needs to be investigated",
    "needs to be surfaced",
    "needs to be addressed",
    "needs investigation",
    "needs wiring",
    "to be investigated",
    "to be wired",
    "to be surfaced",
    "to be addressed",
)

# Convenience union for detectors that want the broadest sweep.
ALL_DEFERRAL: tuple[str, ...] = (
    DEFERRAL_FUTURE_TENSE
    + DEFERRAL_FLAG_FOR_LATER
    + DEFERRAL_ACK_NO_FIX
    + DEFERRAL_CANT_DO
)

# Scope-escape: phrases the agent uses to JUSTIFY skipping a problem by
SCOPE_ESCAPE: tuple[str, ...] = (
    "pre-existing",
    "preexisting",
    "pre existing",
    "not introduced by",
    "not introduced in this",
    "not from this turn",
    "not from this change",
    "not produced by this turn",
    "not produced by this change",
    "not caused by this",
    "not caused by my",
    "not caused by these",
    "not related to this turn",
    "not related to this change",
    "not related to my changes",
    "unrelated to this turn",
    "unrelated to my changes",
    "in unrelated files",
    "in an unrelated file",
    "in other unrelated",
    "outside the scope of this turn",
    "outside this turn's scope",
    "outside the scope of my changes",
    "out of scope of this turn",
    "out of scope of this change",
    "doesn't belong to this turn",
    "doesn't belong to this change",
    "isn't part of this turn",
    "not part of this turn",
    "not part of this work",
    "before my changes",
    "predates this",
    "predates my changes",
    "predates the change",
    "not new",
    "not a new failure",
    "not a regression",
    "not regressed by",
    "not introduced here",
    "outside this commit",
    "wasn't caused by",
    "wasn't introduced by",
    "wasn't introduced here",
)
