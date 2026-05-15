"""ISA (Ideal State Artifact) library -- parse / validate / scaffold.

The ISA is a per-task articulation document with a fixed 12-section
structure. Each ISC (Ideal State Criterion) is one binary tool-probe
question. ID-stability is enforced: edits never renumber criteria.

Pattern borrowed from PAI v6.3.0 (danielmiessler/Personal_AI_Infrastructure).
Polychron-side conventions:

  - ISA lives at `<project>/ISA.md` for persistent things, or
    `tmp/isa/<slug>/ISA.md` for one-shot work.
  - Tier-required sections are HARD-gated by `check_completeness()`.
  - Anti-criteria (`Anti: <X>`) are required at E2+.
  - The Verification section gets one row per ISC at completion.

Public API:
  parse_isa(path)        -- return structured dict
  check_completeness(d, tier) -- list of missing required sections
  list_isc(d)            -- every criterion + status
  unverified_iscs(d)     -- ISCs marked [x] without a Verification entry
  scaffold(slug, ...)    -- produce a fresh ISA from TEMPLATE.md

ID-stability check (`audit_id_stability(old, new)`) refuses any change
that re-numbers an existing ISC id; the only legal additions are
tombstones (DROPPED markers) or splits (ISC-N -> ISC-N.M).
"""
from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from pathlib import Path

_HERE = Path(__file__).resolve().parent
_PROJECT = Path(os.environ.get("PROJECT_ROOT") or _HERE.parent.parent.parent.parent)
_TEMPLATE = _PROJECT / "tools" / "HME" / "skills" / "ISA" / "TEMPLATE.md"

# Twelve canonical sections in ORDER. Order is enforced by the structural
# parser -- out-of-order sections are flagged.
SECTIONS = (
    "Problem", "Vision", "Out of Scope", "Principles", "Constraints",
    "Goal", "Criteria", "Test Strategy", "Features",
    "Decisions", "Changelog", "Verification",
)

# Tier completeness gate -- which sections MUST be populated at each tier.
TIER_REQUIRED = {
    "E1": {"Goal", "Criteria"},
    "E2": {"Problem", "Goal", "Criteria", "Test Strategy"},
    "E3": {"Problem", "Vision", "Out of Scope", "Principles",
           "Constraints", "Goal", "Criteria", "Test Strategy", "Features"},
    "E4": set(SECTIONS),
    "E5": set(SECTIONS),
}

_SECTION_RE = re.compile(r"^##\s+(.+?)\s*$", re.MULTILINE)
# ISC status accepts three shapes:
_ISC_RE = re.compile(
    r"^\s*-\s*\[(?P<status>[ x]|DEFERRED-VERIFY:[A-Za-z0-9._\-]+)\]\s*"
    r"(?P<id>ISC-[0-9]+(?:\.[0-9]+)?)"
    r"\s*:\s*(?P<body>.+?)\s*$",
    re.MULTILINE,
)
_DEFERRED_RE = re.compile(r"^DEFERRED-VERIFY:(?P<task>[A-Za-z0-9._\-]+)$")
_TOMBSTONE_RE = re.compile(r"\[DROPPED\b", re.IGNORECASE)
_FRONTMATTER_RE = re.compile(
    r"\A---\s*\n(.*?)\n---\s*\n", re.DOTALL,
)


@dataclass
class ISC:
    id: str
    status: str          # "[ ]", "[x]", or "[DEFERRED-VERIFY:<task-id>]"
    body: str
    is_anti: bool = False
    is_antecedent: bool = False
    is_tombstone: bool = False
    deferred_task: str = ""   # populated when status is DEFERRED-VERIFY
    is_deferred: bool = False


@dataclass
class ParsedISA:
    path: Path
    frontmatter: dict[str, str] = field(default_factory=dict)
    sections: dict[str, str] = field(default_factory=dict)
    section_order: list[str] = field(default_factory=list)
    iscs: list[ISC] = field(default_factory=list)


def parse_isa(path: str | Path) -> ParsedISA:
    """Parse an ISA.md file into structured form. Loud on missing file --
    silent fallbacks at this layer would mask whether the artifact exists
    (the agent rule we just hardened in audit-loc applies here too)."""
    p = Path(path)
    if not p.is_file():
        raise FileNotFoundError(f"isa_lib.parse_isa: no ISA at {p}")
    src = p.read_text(encoding="utf-8")
    out = ParsedISA(path=p)

    fm = _FRONTMATTER_RE.match(src)
    if fm:
        for line in fm.group(1).splitlines():
            if ":" in line:
                k, v = line.split(":", 1)
                out.frontmatter[k.strip()] = v.strip()
        body = src[fm.end():]
    else:
        body = src

    # Walk H2 sections, capturing body between each.
    matches = list(_SECTION_RE.finditer(body))
    for i, m in enumerate(matches):
        name = m.group(1).strip()
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(body)
        out.sections[name] = body[start:end].strip()
        out.section_order.append(name)

    crit = out.sections.get("Criteria", "")
    for m in _ISC_RE.finditer(crit):
        body_text = m.group("body").strip()
        raw_status = m.group("status")
        deferred_match = _DEFERRED_RE.match(raw_status)
        out.iscs.append(ISC(
            id=m.group("id"),
            status=f"[{raw_status}]",
            body=body_text,
            is_anti=body_text.lower().startswith("anti:"),
            is_antecedent=body_text.lower().startswith("antecedent:"),
            is_tombstone=bool(_TOMBSTONE_RE.search(body_text)),
            deferred_task=deferred_match.group("task") if deferred_match else "",
            is_deferred=bool(deferred_match),
        ))
    return out


def deferred_iscs(d: ParsedISA) -> list[ISC]:
    """ISCs marked [DEFERRED-VERIFY:<task-id>]. PAI escape clause: the
    criterion cannot be marked [x] until the deferred probe runs and the
    linked task closes. The audit surfaces these so the agent can't
    silently flip them to [x] without resolving the deferred claim."""
    return [isc for isc in d.iscs if isc.is_deferred]


def deferred_resolution_violations(d: ParsedISA, prev: "ParsedISA | None"
                                   ) -> list[str]:
    """Refuse silent [DEFERRED-VERIFY:<task>] -> [x] flips.

    PAI rule: "Cannot be marked [x] until the deferred probe runs."
    Enforced by requiring the Verification section to mention the
    deferred task id once an ISC transitions from DEFERRED-VERIFY to [x].
    The previous parsed ISA (if available) tells us which IDs were
    deferred-with-task before; if any of those flipped to [x] in the new
    ISA without the task id appearing in Verification, that's a violation.

    No previous ISA = first audit, can't detect transitions; returns [].
    """
    if prev is None:
        return []
    prev_deferred = {isc.id: isc.deferred_task for isc in prev.iscs
                     if isc.is_deferred}
    if not prev_deferred:
        return []
    verif = d.sections.get("Verification", "")
    violations = []
    for isc in d.iscs:
        if isc.id not in prev_deferred:
            continue
        if isc.status != "[x]":
            continue
        task = prev_deferred[isc.id]
        if task not in verif:
            violations.append(
                f"{isc.id}: previously [DEFERRED-VERIFY:{task}], now [x] "
                f"but Verification section doesn't reference task {task!r} -- "
                f"resolved-task evidence is required to close a deferred ISC"
            )
    return violations


def check_completeness(d: ParsedISA, tier: str) -> list[str]:
    """Return list of section names that the tier requires but are
    missing or empty. Empty list = ISA is complete for this tier."""
    if tier not in TIER_REQUIRED:
        raise ValueError(
            f"isa_lib.check_completeness: unknown tier {tier!r}. "
            f"Valid: {sorted(TIER_REQUIRED.keys())}"
        )
    required = TIER_REQUIRED[tier]
    missing = []
    for sec in required:
        body = d.sections.get(sec, "").strip()
        if not body or body.startswith("<!--") and body.endswith("-->"):
            missing.append(sec)
    return sorted(missing)


def section_order_violations(d: ParsedISA) -> list[str]:
    """ISA section order is fixed (see SECTIONS). Return any sections
    that appear out of canonical order. Sections not in the canonical
    list are tolerated (custom appendices) but flagged."""
    canonical = {s: i for i, s in enumerate(SECTIONS)}
    violations = []
    last_idx = -1
    for sec in d.section_order:
        idx = canonical.get(sec)
        if idx is None:
            violations.append(f"non-canonical section: {sec!r}")
            continue
        if idx < last_idx:
            violations.append(f"out-of-order: {sec!r} appears after a later canonical section")
        last_idx = max(last_idx, idx)
    return violations


def list_isc(d: ParsedISA) -> list[ISC]:
    return list(d.iscs)


def unverified_iscs(d: ParsedISA) -> list[ISC]:
    """ISCs marked done ([x]) but not present in the Verification section.
    PAI Rule 1: no [x] without tool-verified probe evidence in the same
    block or the Verification section. Tombstones are exempt."""
    verif = d.sections.get("Verification", "")
    out = []
    for isc in d.iscs:
        if isc.status != "[x]":
            continue
        if isc.is_tombstone:
            continue
        if isc.id not in verif:
            out.append(isc)
    return out


def audit_id_stability(old: ParsedISA, new: ParsedISA) -> list[str]:
    """Compare two parsed ISAs and report id-stability violations.

    Legal moves:
      - new ISC ids that didn't exist before (additions)
      - existing ISC-N becoming `[x]` or content changes
      - existing ISC-N becoming a tombstone (DROPPED)
      - splits: ISC-N still exists AND new children ISC-N.M appear

    Illegal moves:
      - existing ISC-N missing entirely from new (silent renumber)
      - body of existing ISC-N changes its meaning (heuristic: anti-flag flip)
    """
    old_by_id = {isc.id: isc for isc in old.iscs}
    new_by_id = {isc.id: isc for isc in new.iscs}
    violations = []
    for isc_id, old_isc in old_by_id.items():
        if isc_id not in new_by_id:
            violations.append(
                f"{isc_id}: removed from new ISA without tombstone -- "
                f"renumber/silent-drop is forbidden by ID-stability rule"
            )
            continue
        new_isc = new_by_id[isc_id]
        if old_isc.is_anti and not new_isc.is_anti:
            violations.append(
                f"{isc_id}: 'Anti:' prefix removed -- anti-criteria are "
                f"derived probes; flipping their kind silently changes the "
                f"test surface"
            )
    return violations


def scaffold(slug: str, title: str, tier: str = "E2",
             dest: Path | None = None) -> Path:
    """Write a fresh ISA from TEMPLATE.md to dest (default
    tmp/isa/<slug>/ISA.md). Returns the destination path."""
    if not _TEMPLATE.is_file():
        raise FileNotFoundError(f"isa_lib.scaffold: template missing at {_TEMPLATE}")
    if tier not in TIER_REQUIRED:
        raise ValueError(f"isa_lib.scaffold: unknown tier {tier!r}")
    if dest is None:
        dest = _PROJECT / "tmp" / "isa" / slug / "ISA.md"
    dest.parent.mkdir(parents=True, exist_ok=True)

    import datetime
    now = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    src = _TEMPLATE.read_text(encoding="utf-8")
    src = src.replace("<one-word-slug>", slug)
    src = src.replace("<YYYY-MM-DDTHH:MM:SSZ>", now)
    src = src.replace("<one-line title>", title, 1)
    src = src.replace("E1 | E2 | E3 | E4 | E5", tier)
    src = src.replace("observe | think | plan | build | execute | verify | complete", "observe")
    dest.write_text(src, encoding="utf-8")
    return dest
