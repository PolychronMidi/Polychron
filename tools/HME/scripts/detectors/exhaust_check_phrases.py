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
    # "Banked / waiting-on-user-action" register: "I did my part, waiting on you" frame.
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
    # "Fit" excuse register: subset-of-the-ask dressed as compatibility judgment.
    "low fit",
    "low-fit",
    "poor fit",
    "poor-fit",
    "weak fit",
    "wrong fit",
    "bad fit",
    "low signal",
    "low-signal",
    "high-fit subset",
    "small subset",
    "narrow subset",
    "content-publishing-shaped",
    "content publishing shaped",
    "content-creation-shaped",
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
    # X-of-Y partial-coverage framing. "(8 of 29)" / "5 of 12 fixes" /
    # "shipped 3 of 7 patterns". User asked for all; agent shipped some.
    # Scoped to deferral-shape nouns so legitimate "page 2 of 5" / "v3
    # of 4 schemas" stays clear. Catches the exact framing that motivated
    # this addition: "8 of 29 patterns".
    re.compile(
        r"\b\d+\s+(?:of|out\s+of)\s+\d+\b[^\n]{0,40}\b("
        r"pattern|item|fix|tool|bug|finding|opportunit|implement|"
        r"change|gap|improvement|recommendation|integration|task|"
        r"point|verifier|hook|cache|rule|check)s?\b",
        re.IGNORECASE,
    ),
    # "Subset" framing. "high-fit subset for X" / "subset that ships /
    # covers / fits". When user asked for the full set, naming a subset
    # is a punt.
    re.compile(
        r"\bsubset\b[^.\n]{0,40}\b("
        r"implement|cover|ship|land|fix|scope|fit|focus|priorit"
        r")\w*",
        re.IGNORECASE,
    ),
    # Explicit fit-excuse classification. "X is low/poor fit for Y",
    # "low fit for tool output", "poor fit for engineering".
    re.compile(
        r"\b(low|poor|weak|wrong|bad|less|low-)\s*[- ]?\s*fit\b\s+for\b",
        re.IGNORECASE,
    ),
)
