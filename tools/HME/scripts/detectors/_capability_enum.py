"""Closed enumeration of declared thinking + delegation capabilities.

PAI v6.3.0 doctrine: "The thinking-capability vocabulary is a CLOSED
ENUMERATION. Selection MUST come verbatim from this list. Inventing
generic labels ('decomposition', 'edge-case enumeration', 'tradeoff
analysis', 'deep reasoning') is a PHANTOM thinking capability and
counts as a CRITICAL FAILURE."

This module owns the canonical list. The phantom_capability detector
parses the agent's closing summary for declared capabilities and
asserts each declared name is in this enumeration. Adding a new
capability = edit this list + bump the version stamp + add a
recognizer description to capabilities.md (TODO).

Polychron-side adaptation: the enumeration covers the capabilities
this codebase exercises, not PAI's full set. We DO use first-principles
reasoning, root-cause analysis, red-team adversarial probes (selftest
probes), and so on. We do NOT have PAI-specific capabilities like Forge,
Anvil, Cato, Fabric.
"""
from __future__ import annotations

# Version: bump on additions or removals.
ENUMERATION_VERSION = "0.2.0-polychron"

# Thinking-capability vocabulary (closed). Verbatim names.
THINKING_CAPABILITIES = (
    # General cognitive moves
    "FirstPrinciples",
    "SystemsThinking",
    "RootCauseAnalysis",
    "FiveWhys",                 # canonical 5-Whys
    "ReReadCheck",              # final gate, re-read user prompt
    "ApertureOscillation",      # tactical/strategic scope switch
    "IterativeDepth",           # multi-angle re-deepening

    # Multi-agent / adversarial
    "Council",                  # multi-agent debate with visible transcripts
    "RedTeam",                  # adversarial stress-test

    # Project-specific
    "FeedbackMemoryConsult",    # grep prior feedback / KB for matching incidents
    "ContextSearch",            # 2-phase prior project work search
    "ISA",                      # ISA-skill invocation (when analytical, not just scaffold)
    "Evals",                    # code/model/human grader scoring
    "BeCreative",               # divergent ideation
    "BitterPillEngineering",    # over-prompting audit

    # Polychron-native (HME)
    "HCIVerifier",              # invoke verify-coherence.py with intent
    "Holograph",                # snapshot-holograph diff for state drift
    "DetectorChainTest",        # corpus + chain test as analytical move
    "AuditAll",                 # run scripts/audit-all.sh as analytical move
)

# Delegation-capability vocabulary (closed). Verbatim names.
DELEGATION_CAPABILITIES = (
    "Subagent",                 # general-purpose / Plan / Explore subagent
    "BackgroundJob",            # run_in_background bash
    "Worktree",                 # EnterWorktree / ExitWorktree
)

# Phantom-detection signal phrases -- patterns that LOOK like declared
PHANTOM_PATTERNS = (
    "decomposition",
    "edge-case enumeration",
    "tradeoff analysis",
    "deep reasoning",
    "structured thinking",
    "first-principles decomposition",   # paraphrase of FirstPrinciples
    "systems-thinking analysis",        # paraphrase
    "root cause investigation",         # paraphrase of RootCauseAnalysis
    "deep think",                       # paraphrase of IterativeDepth
)


def is_known_thinking(name: str) -> bool:
    return name in THINKING_CAPABILITIES


def is_known_delegation(name: str) -> bool:
    return name in DELEGATION_CAPABILITIES


def all_known() -> set[str]:
    return set(THINKING_CAPABILITIES) | set(DELEGATION_CAPABILITIES)
