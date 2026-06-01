"""Deferral phrase + regex tables. Imports shared categories from `_phrase_lists.py` (the consolidation point per its docstring) so the 7-entry overlap that existed between this module and `_phrase_lists.ALL_DEFERRAL` is eliminated. exhaust_check.py imports DEFERRAL_PHRASES + DEFERRAL_REGEXES from here unchanged."""
from __future__ import annotations
import re

from _phrase_lists import ALL_DEFERRAL as _SHARED_DEFERRAL  # noqa: E402

_EXHAUST_LOCAL_PHRASES = (
    "noted not yet fixed",
    "noted, not yet fixed",
    "noted as remaining",
    "remaining tools",
    "remaining items",
    "remaining issues",
    "remaining gaps",
    "remaining non-ecstatic",
    "not fixed yet",
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
    "i should have:",
    # "Banked / waiting-on-user-action" register: "I did my part, waiting on you" frame.
    "still banked",
    "banked for",
    "banked until",
    "takes effect on next",
    "takes effect when",
    "will take effect",
    "on next proxy restart",
    "on next extension",
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
    "next work only",
    "completion only",
)

DEFERRAL_PHRASES = _SHARED_DEFERRAL + _EXHAUST_LOCAL_PHRASES


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
        r"\bworth\s+(a|an|another|more|its\s+own|the|a\s+separate)\b[^\n]{0,40}?"
        r"\b(pass|review|look|investigation|run|follow-?up|round|session|diagnostic|sweep)\b",
        re.IGNORECASE,
    ),
    re.compile(
        r"\b(?:still\s+)?deserves?\s+(?:a|an|another|separate)\b[^\n]{0,50}?"
        r"\b(hardening|pass|fix|review|investigation|follow-?up|diagnostic|work|sweep)\b",
        re.IGNORECASE,
    ),
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
    # X-of-Y partial-coverage framing. Scoped to deferral-shape nouns
    # so legitimate "page 2 of 5" stays clear.
    re.compile(
        r"\b\d+\s+(?:of|out\s+of)\s+\d+\b[^\n]{0,40}\b("
        r"pattern|item|fix|tool|bug|finding|opportunit|implement|"
        r"change|gap|improvement|recommendation|integration|task|"
        r"point|verifier|hook|cache|rule|check)s?\b",
        re.IGNORECASE,
    ),
    # "Subset" framing. "high-fit subset for X" / "subset that ships /
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
