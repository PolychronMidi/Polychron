"""Deferral phrase + regex tables -- extracted from exhaust_check.py."""
from __future__ import annotations
import re

DEFERRAL_PHRASES = (
    "noted not fixed",
    "noted, not fixed",
    "noted not yet fixed",
    "noted, not yet fixed",
    "noted as remaining",
    "remaining tools",
    "remaining items",
    "remaining work",
    "remaining issues",
    "remaining gaps",
    "remaining non-ecstatic",
    "still not fixed",
    "not fixed yet",
    "not yet fixed",
    "not yet implemented",
    "not yet addressed",
    "not yet handled",
    "tbd:",
    "tbd ",
    "(tbd)",
    "[tbd]",
    "to-do:",
    "to do:",
    "todo:",
    "deferred:",
    "deferred to next",
    "punt to next",
    "skipped (not blocking)",
    "left for later",
    "for a future turn",
    "in a follow-up",
    "follow-up turn",
    "next turn could",
    "needs follow-up",
    "for next session",
    "future work:",
    # Added after the "flagging for the backlog" evasion slipped through:
    # the user asked for all fixes; agent punted two items with these phrasings.
    "flagging for the backlog",
    "flag for the backlog",
    "flag for backlog",
    "for the backlog",
    "add to the backlog",
    "rather than attempting now",
    "rather than attempt now",
    "not attempting now",
    "not attempting here",
    "worth a separate",
    "separate follow-up",
    "separate followup",
    "worth a follow-up",
    "worth an i/",        # e.g. "worth an i/status follow-up"
    "worth an hme",
    "non-trivial change",
    "non-trivial; flagging",
    "out of scope for this",
    "outside this session",
    "outside the scope of this",
    "another session",
    "next session could",
    "leaving for the backlog",
    "leaving for later",
    "leaving to later",
    "parking this",
    "parked for later",
    "skip for now",
    "skipping for now",
    "defer for now",
    "deferring for now",
    "won't fix this round",
    "won't fix this session",
    "didn't fix this round",
    "didn't fix this session",
    "didn't fix in this",
    "not fix in this session",
    "left undone",
    "left unfinished",
    "not covered here",
    "not covered in this session",
    "scope creep",
    "separate investigation",
    "a separate pass",
    "a later pass",
    "not this turn",
    "another turn",
    # "Banked / waiting-on-user-action" register. Added after a session where
    # the agent closed with "Still banked (not actionable right now): supervisor
    # fix -- takes effect on next proxy restart" and similar "needs an external
    # action before it lands" handoffs. Those ARE handoffs, but they wore
    # technical garb and slipped every deferral pattern above. This register
    # catches the "I did my part, waiting on you" frame.
    "still banked",
    "banked for",
    "banked until",
    "takes effect on next",
    "takes effect when",
    "will take effect",
    "on next proxy restart",
    "on next extension",
    "on next session",
    "on next reload",
    "next extension reload",
    "next extension-host reload",
    "requires a restart",
    "requires restart",
    "requires reload",
    "requires a reload",
    "user-initiated",
    "user action required",
    "user action needed",
    "waiting on a restart",
    "waiting on reload",
    "needs a restart",
    "needs a reload",
    "only takes effect",
    "once the proxy restarts",
    "once the user reloads",
    "when you restart",
    "when you reload",
)


DEFERRAL_REGEXES = (
    re.compile(
        r"\bremaining\b[^\n]{0,60}?\b("
        r"gap|item|work|issue|bug|task|piece|thing|fix|tool|edit|change|"
        r"finding|opportunit|investigation|cleanup|todo|chore|debt|followup|follow-up"
        r")s?\b",
        re.IGNORECASE,
    ),
    re.compile(
        r"\b(still|not yet|haven'?t|didn'?t|won'?t|can'?t)\b[^\n]{0,40}?"
        r"\b(fix|address|implement|handle|cover|tackle|complete|finish|land|ship|do)\b",
        re.IGNORECASE,
    ),
    re.compile(
        r"^\s*#{1,6}\s*(remaining|deferred|backlog|follow-?up|future|known gaps?|"
        r"todo|punt|next session|later|out of scope|outstanding)\b",
        re.IGNORECASE | re.MULTILINE,
    ),
    re.compile(
        r"\*\*\s*(remaining|deferred|backlog|follow-?up|future|known gaps?|"
        r"todo|punt|next session|later|out of scope|outstanding)\b",
        re.IGNORECASE,
    ),
    re.compile(
        r"\bworth\s+(a|an|another|more)\b[^\n]{0,40}?"
        r"\b(pass|review|look|investigation|run|follow-?up|round|session)\b",
        re.IGNORECASE,
    ),
    # "Takes effect on next ..." / "requires a restart" handoffs -- the "I did
    # my part, waiting on you" frame. Structural because the specific
    # wording varies (next proxy restart / next reload / next session / etc.).
    re.compile(
        r"\b(takes|will take)\s+effect\s+(on|when|after)\b",
        re.IGNORECASE,
    ),
    re.compile(
        r"\b(requires|needs|waiting\s+on|pending)\s+(a\s+|an\s+)?"
        r"(restart|reload|user\s+action|session\s+restart|extension\s+(host\s+)?reload)\b",
        re.IGNORECASE,
    ),
    re.compile(
        r"\bonce\s+(you\s+|the\s+)?(restart|reload|proxy|session|user)\b",
        re.IGNORECASE,
    ),
    # "I can build/implement/fix that" -- offering future work instead of
    # doing it now. The "I'll do it next time / want me to" frame.
    re.compile(
        r"\bI\s+(can|could|will|would|might|should)\s+"
        r"(build|implement|fix|address|handle|land|ship|do|tackle|"
        r"add|wire|migrate|convert|expand|extend|create|write|set\s+up)\b",
        re.IGNORECASE,
    ),
    # "Want me to" / "Should I" / "Would you like me to" -- punts decision
    # to the user instead of executing under existing authority. Mirrors
    # PSYCHOPATHIC-STOP's survey-and-ask pattern but caught at exhaust time.
    re.compile(
        r"\b(want|need)\s+me\s+to\b|"
        r"\bshould\s+I\b|"
        r"\bwould\s+you\s+(like|want)\s+me\s+to\b|"
        r"\bdo\s+you\s+want\s+me\s+to\b",
        re.IGNORECASE,
    ),
    # "Tell me which" / "let me know" / "point me at" / "specify" --
    # direct handoff to the user for required input.
    re.compile(
        r"\b(tell|let|point|show|give)\s+me\b[^\n]{0,40}?"
        r"\b(which|what|where|the\s+specific|the\s+concrete|to\s+(it|that))\b",
        re.IGNORECASE,
    ),
    # "Pick a direction" / "choose one" / "which option" -- multi-option
    # presentation as substitute for execution.
    re.compile(
        r"\b(pick|choose|select)\s+(a|an|one|which)\b[^\n]{0,40}?"
        r"\b(option|direction|approach|path|route|frontier|move)\b",
        re.IGNORECASE,
    ),
    # Bullet/branch labels with bold-(a)/(b) where final text presents
    # multiple paths as a question to the user.
    re.compile(
        r"^\s*\([a-c]\)\s*\*\*[^*]+\*\*",
        re.MULTILINE,
    ),
)
