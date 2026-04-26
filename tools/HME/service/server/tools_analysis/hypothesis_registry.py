"""HME hypothesis lifecycle registry — Phase 3.1 of openshell_features_to_mimic.md.

Tracks the Evolver's causal claims as first-class machine-queryable records
rather than prose buried in the journal. Every hypothesis has a proposer
round, a claim, a falsification criterion, a list of rounds in which it was
tested, a status, and a list of modules it applies to.

Stored in `metrics/hme-hypotheses.json` (plain JSON, not lance — small
structured data, human-editable, survives schema evolution).

Exposed via:
  learn(action='hypothesize', title=..., content=..., falsification=...,
        modules=[...], round=..., relation_type='open')
  learn(action='hypothesis_test', remove=<id>, content=<CONFIRMED|REFUTED|
        INCONCLUSIVE>, round=..., listening_notes=<evidence>)
  status(mode='hypotheses')      — all, grouped by status
  status(mode='hypotheses-open') — only OPEN

Reserve the 6-tool public surface: no new top-level tools, new modes and
actions piggyback on `learn` and `status`.
"""
from __future__ import annotations

import hashlib
import json
import os
import time
from typing import Any

from server import context as ctx
from . import _track

REGISTRY_REL = os.path.join("output", "metrics", "hme-hypotheses.json")

VALID_STATUSES = {"OPEN", "CONFIRMED", "REFUTED", "INCONCLUSIVE", "ABANDONED"}


def _registry_path() -> str:
    return os.path.join(ctx.PROJECT_ROOT, REGISTRY_REL)


def _load() -> dict:
    path = _registry_path()
    if not os.path.exists(path):
        return {"meta": {"created": int(time.time())}, "hypotheses": []}
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return {"meta": {"created": int(time.time())}, "hypotheses": []}


def _save(data: dict) -> None:
    path = _registry_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    data.setdefault("meta", {})
    data["meta"]["updated"] = int(time.time())
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
        f.write("\n")


def _short_id(claim: str) -> str:
    h = hashlib.blake2b(claim.encode("utf-8"), digest_size=6).hexdigest()
    return h


def add_hypothesis(
    claim: str,
    falsification: str,
    modules: list[str] | None = None,
    round_tag: str = "",
    evidence: str = "",
) -> str:
    """Register a new hypothesis. Returns markdown summary + assigned id."""
    _track("hypothesis_add")
    if not claim or not claim.strip():
        return "Error: hypothesis claim is required."
    if not falsification or not falsification.strip():
        return (
            "Error: falsification criterion is required. A hypothesis without a "
            "falsifier is just a prediction."
        )
    data = _load()
    now = int(time.time())
    new_id = _short_id(claim + str(now))
    entry = {
        "id": new_id,
        "claim": claim.strip(),
        "falsification": falsification.strip(),
        "modules": list(modules or []),
        "proposer_round": round_tag or "",
        "tested_in": [],
        "status": "OPEN",
        "created_ts": now,
        "updated_ts": now,
        "evidence": [],
    }
    if evidence:
        entry["evidence"].append({"round": round_tag, "note": evidence, "ts": now})
    data["hypotheses"].append(entry)
    _save(data)
    return (
        f"# Hypothesis registered: `{new_id}`\n\n"
        f"**Claim:** {claim}\n\n"
        f"**Falsifiable by:** {falsification}\n\n"
        f"**Modules:** {', '.join(modules) if modules else '(none)'}\n"
        f"**Proposer round:** {round_tag or '(unspecified)'}\n\n"
        "Test with: `learn(action='hypothesis_test', "
        f"remove='{new_id}', content='CONFIRMED|REFUTED|INCONCLUSIVE', "
        "round='R..', listening_notes='evidence')`"
    )


def test_hypothesis(
    hypothesis_id: str,
    verdict: str,
    round_tag: str = "",
    evidence: str = "",
) -> str:
    """Record a test result against an existing hypothesis."""
    _track("hypothesis_test")
    verdict_u = (verdict or "").upper()
    if verdict_u not in VALID_STATUSES - {"OPEN"}:
        return (
            f"Error: verdict must be one of {sorted(VALID_STATUSES - {'OPEN'})}. "
            f"Got: {verdict!r}"
        )
    data = _load()
    found = None
    for h in data.get("hypotheses", []):
        if h.get("id") == hypothesis_id:
            found = h
            break
    if not found:
        return f"Error: no hypothesis with id `{hypothesis_id}`."

    now = int(time.time())
    tested_in = list(found.get("tested_in") or [])
    if round_tag and round_tag not in tested_in:
        tested_in.append(round_tag)
    found["tested_in"] = tested_in
    found["status"] = verdict_u
    found["updated_ts"] = now
    evidence_list = list(found.get("evidence") or [])
    evidence_list.append(
        {"round": round_tag, "verdict": verdict_u, "note": evidence, "ts": now}
    )
    found["evidence"] = evidence_list
    _save(data)
    return (
        f"# Hypothesis `{hypothesis_id}` → **{verdict_u}**\n\n"
        f"**Claim:** {found.get('claim', '?')}\n\n"
        f"**Tested in:** {', '.join(tested_in) or '(none recorded)'}\n\n"
        f"**Evidence:** {evidence or '(none provided)'}"
    )


def list_hypotheses(status_filter: str = "") -> list[dict]:
    """Return raw hypothesis list, optionally filtered by status."""
    data = _load()
    entries = data.get("hypotheses", []) or []
    if not status_filter:
        return entries
    wanted = status_filter.upper()
    return [h for h in entries if h.get("status") == wanted]


def hypotheses_for_modules(modules: list[str]) -> list[dict]:
    """Return OPEN hypotheses whose `modules` list intersects the given set."""
    if not modules:
        return []
    target = set(modules)
    out: list[dict] = []
    for h in list_hypotheses(status_filter="OPEN"):
        hm = set(h.get("modules") or [])
        if hm & target:
            out.append(h)
    return out


def hypotheses_report(status_filter: str = "") -> str:
    """Markdown digest grouped by status, or filtered to one status."""
    _track("hypotheses_report")
    entries = list_hypotheses(status_filter=status_filter)
    if not entries:
        return (
            "# Hypothesis Registry\n\n"
            + (
                f"No hypotheses with status={status_filter.upper()}."
                if status_filter
                else "Registry is empty.\n\nAdd one with `learn(action='hypothesize', "
                "title='claim', content='falsification criterion', "
                "tags=['module1','module2'], query='R93')`"
            )
        )
    entries.sort(key=lambda e: (e.get("updated_ts", 0) or 0), reverse=True)
    by_status: dict[str, list[dict]] = {}
    for h in entries:
        by_status.setdefault(h.get("status", "OPEN"), []).append(h)

    lines = ["# Hypothesis Registry", ""]
    for status in ("OPEN", "CONFIRMED", "REFUTED", "INCONCLUSIVE", "ABANDONED"):
        hs = by_status.get(status, [])
        if not hs:
            continue
        lines.append(f"## {status} ({len(hs)})")
        for h in hs[:15]:
            tested = h.get("tested_in") or []
            mods = h.get("modules") or []
            lines.append(f"  `{h.get('id', '?'):<12}` {h.get('claim', '?')[:100]}")
            lines.append(
                f"    falsifier: {h.get('falsification', '?')[:90]}"
            )
            if mods:
                lines.append(f"    modules:   {', '.join(mods[:6])}")
            if tested:
                lines.append(f"    tested:    {', '.join(tested[-5:])}")
        if len(hs) > 15:
            lines.append(f"  … and {len(hs) - 15} more")
        lines.append("")
    return "\n".join(lines)
