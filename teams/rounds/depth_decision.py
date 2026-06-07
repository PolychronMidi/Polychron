"""Evidence-weighted mesh depth escalation decisions.

This module turns per-role depth votes into one durable, anti-bloat decision row.
It decides only whether to buy more debate depth; it never decides whether a
finding is true. Truth still comes from evidence: files, tests, contradictions,
reproducers, or explicit AUDIT-UNCERTAIN.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path
from typing import Any

DEPTH_MIN = 0
DEPTH_MAX = 5
DEPTH_LABELS = {
    0: "solo_or_stop",
    1: "one_peer_check",
    2: "red_blue_purple_one_pass",
    3: "cross_exam",
    4: "debate_hall",
    5: "post_patch_audit",
}

ROLE_WEIGHTS = {
    "red": 1.15,
    "red_lead": 1.15,
    "blue": 1.15,
    "blue_lead": 1.15,
    "purple": 1.15,
    "red_purple": 1.15,
    "blue_purple": 1.15,
    "driver": 1.0,
}
CONFIDENCE_WEIGHTS = {
    "low": 0.75,
    "medium": 1.0,
    "med": 1.0,
    "high": 1.25,
}

# Evidence gates dominate popularity. A single grounded gate can buy the next
# debate layer even when most votes are "stop".
GATE_MIN_DEPTH = {
    "p0": 5,
    "p1": 3,
    "fail_open": 4,
    "fail-open": 4,
    "security": 4,
    "secret": 4,
    "data_loss": 4,
    "data-loss": 4,
    "hook_bypass": 4,
    "hook-bypass": 4,
    "guard_surface": 4,
    "guard-surface": 4,
    "hook_guard_surface": 4,
    "hook/guard_surface": 4,
    "agent_routing": 4,
    "agent-routing": 4,
    "context_compaction": 4,
    "context-compaction": 4,
    "hci_fail": 4,
    "hci-fail": 4,
    "verifier": 4,
    "todo_plan": 4,
    "todo/plan": 4,
    "failing_test": 3,
    "failing-test": 3,
    "contradiction": 3,
    "user_intent_ambiguity": 3,
    "user-intent-ambiguity": 3,
}

DEESCALATE_REASONS = {
    "scope_bloat",
    "scope-bloat",
    "enough_evidence",
    "enough-evidence",
    "settled_by_test",
    "settled-by-test",
    "repetition",
}

OVERRIDE_REASONS = {
    "user_intent",
    "user-intent",
    "scope",
    "project_invariant",
    "project-invariant",
    "cost_coherence",
    "cost-coherence",
    "evidence_gate",
    "evidence-gate",
}

_BLANK_EVIDENCE = {"", "none", "n/a", "na", "null", "no", "uncited"}
_POLICY_PATH = Path(__file__).with_name("depth_policy.json")


def _load_policy() -> dict[str, Any]:
    try:
        data = json.loads(_POLICY_PATH.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


_POLICY = _load_policy()
ROLE_WEIGHTS = {**ROLE_WEIGHTS, **(_POLICY.get("role_weights") or {})}
CONFIDENCE_WEIGHTS = {**CONFIDENCE_WEIGHTS, **(_POLICY.get("confidence_weights") or {})}
GATE_MIN_DEPTH = {**GATE_MIN_DEPTH, **(_POLICY.get("gate_min_depth") or {})}
DEESCALATE_REASONS = set(_POLICY.get("deescalate_reasons") or DEESCALATE_REASONS)
OVERRIDE_REASONS = set(_POLICY.get("override_reasons") or OVERRIDE_REASONS)
ESCALATION_PROFILES = _POLICY.get("escalation_profiles") or {}


def _clamp_depth(value: Any, default: int = 0) -> int:
    try:
        n = int(value)
    except (TypeError, ValueError):
        n = default
    return max(DEPTH_MIN, min(DEPTH_MAX, n))


def _normalize_reason(value: Any) -> str:
    text = str(value or "").strip().lower()
    text = re.sub(r"\s+", "_", text)
    return text


def _parse_delta(value: Any) -> int:
    if isinstance(value, str):
        value = value.strip().lstrip("+")
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def _has_evidence(value: Any) -> bool:
    text = str(value or "").strip()
    return text.lower() not in _BLANK_EVIDENCE


def _evidence_quality(value: Any) -> float:
    if not _has_evidence(value):
        return 0.0
    text = str(value).upper()
    if "AUDIT-UNCERTAIN" in text:
        return 0.55
    return 1.0


def _extract_gates(reason: str, evidence: str) -> set[str]:
    text = f"{reason} {evidence}".lower()
    gates: set[str] = set()
    probes = {
        "p0": r"(?<![a-z0-9])p0(?![a-z0-9])",
        "p1": r"(?<![a-z0-9])p1(?![a-z0-9])",
        "fail_open": r"fail[-_ ]open",
        "security": r"security|secret|credential|api[-_ ]?key",
        "data_loss": r"data[-_ ]loss",
        "hook_bypass": r"hook[-_ ]bypass|guard[-_ ]bypass",
        "guard_surface": r"guard[-_ ]surface|hook/guard|hook[-_ ]guard|guard|pretool|stop[-_ ]hook",
        "agent_routing": r"agent[-_ ]routing|subagent|team[-_ ]router",
        "context_compaction": r"context[-_ ]compaction|passthrough[-_ ]compact|compact(ion)?",
        "hci_fail": r"hci[-_ ]fail|hci fail|fail/error|fail/error",
        "verifier": r"verifier|verify[-_ ]coherence",
        "todo_plan": r"todo|plan\.md|plan ledger",
        "failing_test": r"failing[-_ ]test|test[-_ ]failure|regression[-_ ]fail",
        "contradiction": r"contradict|disagree|conflict",
        "user_intent_ambiguity": r"user[-_ ]intent|intent[-_ ]ambigu",
    }
    for gate, pattern in probes.items():
        if re.search(pattern, text):
            gates.add(gate)
    return gates


def _weighted_median(items: list[tuple[int, float]]) -> int | None:
    usable = [(depth, weight) for depth, weight in items if weight > 0]
    if not usable:
        return None
    usable.sort(key=lambda item: item[0])
    total = sum(weight for _depth, weight in usable)
    acc = 0.0
    for depth, weight in usable:
        acc += weight
        if acc >= total / 2:
            return depth
    return usable[-1][0]


def normalize_vote(vote: dict[str, Any], current_depth: int, current_evidence_epoch: str | None = None) -> dict[str, Any]:
    role = str(vote.get("role") or "unknown").strip().lower()
    reason = _normalize_reason(vote.get("reason_code", vote.get("reason", "")))
    evidence = str(vote.get("evidence") or "").strip()
    delta = _parse_delta(vote.get("depth_delta", vote.get("delta", 0)))
    confidence = str(vote.get("confidence") or "medium").strip().lower()
    vote_epoch = str(vote.get("evidence_epoch") or "").strip()
    stale = bool(vote.get("stale") or vote.get("expired"))
    if current_evidence_epoch and vote_epoch and vote_epoch != current_evidence_epoch:
        stale = True
    grounded = _has_evidence(evidence) and not stale
    target = vote.get("recommended_depth", vote.get("target_depth", None))
    if target is None:
        target_depth = _clamp_depth(current_depth + delta, current_depth)
    else:
        target_depth = _clamp_depth(target, current_depth)
    quality = _evidence_quality(evidence)
    if stale:
        quality = 0.0
    weight = ROLE_WEIGHTS.get(role, 1.0) * CONFIDENCE_WEIGHTS.get(confidence, 1.0) * quality
    gates = _extract_gates(reason, evidence) if grounded else set()
    return {
        "role": role,
        "delta": delta,
        "target_depth": target_depth,
        "confidence": confidence,
        "reason": reason,
        "evidence": evidence if evidence else "",
        "grounded": grounded,
        "stale": stale,
        "evidence_epoch": vote_epoch,
        "weight": round(weight, 4),
        "gates": sorted(gates),
        "advisory_only": not grounded,
    }


def _decision_name(current_depth: int, next_depth: int, reason: str = "") -> str:
    if next_depth > current_depth:
        label = DEPTH_LABELS[next_depth]
        return f"escalate_to_{label}"
    if next_depth < current_depth:
        label = DEPTH_LABELS[next_depth]
        return f"deescalate_to_{label}"
    if reason:
        return reason
    return "hold_depth"


DEPTH_VOTE_CONTRACT = """\
\nMesh depth vote (required when asked): append one compact JSON object after token MESH_DEPTH_VOTE.\nVotes decide whether to buy more debate depth, never whether a finding is true.\nUse evidence or write AUDIT-UNCERTAIN; unsupported votes are advisory only.\nSchema: MESH_DEPTH_VOTE {\"depth_delta\":\"-1|0|+1|+2\",\"confidence\":\"low|medium|high\",\"reason_code\":\"risk|uncertainty|contradiction|failing-test|architecture|security|hook/guard-surface|scope-bloat|enough-evidence\",\"evidence\":\"file:line/test/channel or AUDIT-UNCERTAIN\",\"evidence_epoch\":\"optional current patch/test id\"}\n"""


def prompt_contract() -> str:
    return DEPTH_VOTE_CONTRACT


def profile_for_depth(depth: int) -> dict[str, Any]:
    depth = _clamp_depth(depth, 0)
    raw = ESCALATION_PROFILES.get(str(depth), {})
    profile = dict(raw) if isinstance(raw, dict) else {}
    profile.setdefault("label", DEPTH_LABELS[depth])
    profile.setdefault("max_tools", 8 if depth >= 2 else 4 if depth == 1 else 0)
    profile.setdefault("max_duration", 600 if depth >= 2 else 300 if depth == 1 else 0)
    profile.setdefault("reply_cap", 12000 if depth >= 2 else 6000 if depth == 1 else 0)
    profile.setdefault("next_action", f"run_{DEPTH_LABELS[depth]}")
    return profile


def extract_vote(text: str, role: str, current_evidence_epoch: str | None = None) -> dict[str, Any] | None:
    """Extract the last MESH_DEPTH_VOTE JSON object from a peer reply."""
    if not text:
        return None
    matches = list(re.finditer(r"MESH_DEPTH_VOTE\s*(\{.*?\})(?=\s*$|\s*[`\n])", text, flags=re.DOTALL))
    if not matches:
        return None
    raw = matches[-1].group(1)
    try:
        vote = json.loads(raw)
    except json.JSONDecodeError:
        return {
            "role": role,
            "depth_delta": "0",
            "confidence": "low",
            "reason_code": "malformed-vote",
            "evidence": "AUDIT-UNCERTAIN: malformed MESH_DEPTH_VOTE JSON",
            "evidence_epoch": current_evidence_epoch or "",
        }
    if not isinstance(vote, dict):
        return None
    vote = dict(vote)
    vote["role"] = str(vote.get("role") or role)
    if current_evidence_epoch and not vote.get("evidence_epoch"):
        vote["evidence_epoch"] = current_evidence_epoch
    return vote


def collect_votes_from_reply_files(role_to_file: dict[str, str], current_evidence_epoch: str | None = None) -> list[dict[str, Any]]:
    votes: list[dict[str, Any]] = []
    for role, file_name in role_to_file.items():
        try:
            data = json.loads(Path(file_name).read_text(encoding="utf-8"))
            reply = str(data.get("reply") or "")
        except (OSError, json.JSONDecodeError, AttributeError):
            continue
        vote = extract_vote(reply, role, current_evidence_epoch)
        if vote is not None:
            votes.append(vote)
    return votes


def compute_depth_decision(
    *,
    current_depth: int,
    votes: list[dict[str, Any]],
    evidence_gates: list[str] | None = None,
    override: dict[str, Any] | None = None,
    round_name: str = "round",
    current_evidence_epoch: str | None = None,
) -> dict[str, Any]:
    current_depth = _clamp_depth(current_depth, 0)
    normalized = [normalize_vote(v, current_depth, current_evidence_epoch) for v in votes]
    external_gates = {_normalize_reason(g) for g in (evidence_gates or []) if str(g or "").strip()}
    vote_gates = {g for v in normalized for g in v["gates"]}
    all_gates = external_gates | vote_gates
    gate_depth = max([GATE_MIN_DEPTH[g] for g in all_gates if g in GATE_MIN_DEPTH] or [None])

    weighted_vote_depth = _weighted_median([(v["target_depth"], v["weight"]) for v in normalized])
    if weighted_vote_depth is None:
        weighted_vote_depth = current_depth

    grounded_positive = [v for v in normalized if v["grounded"] and v["delta"] > 0]
    grounded_negative_or_hold = [v for v in normalized if v["grounded"] and v["delta"] <= 0]
    unsupported_positive = [v for v in normalized if not v["grounded"] and v["delta"] > 0]

    next_depth = weighted_vote_depth
    anti_bloat = "new evidence required next turn"

    if unsupported_positive and not grounded_positive and not all_gates:
        next_depth = min(next_depth, current_depth)
        anti_bloat = "unsupported escalation votes ignored"

    if gate_depth is not None:
        next_depth = max(next_depth, gate_depth)
        anti_bloat = "evidence gate dominated popularity; new evidence required next turn"

    # One grounded high-severity dissent buys at least a cross-exam turn even if the
    # weighted median would otherwise hold. This is not truth-by-dissent; it is a
    if grounded_positive and any(g in GATE_MIN_DEPTH for v in grounded_positive for g in v["gates"]):
        next_depth = max(next_depth, min(DEPTH_MAX, max(current_depth + 1, 3)))

    if not grounded_positive and grounded_negative_or_hold and not all_gates:
        next_depth = min(next_depth, current_depth)
        if all(v["reason"] in DEESCALATE_REASONS or v["delta"] < 0 for v in grounded_negative_or_hold):
            next_depth = min(next_depth, max(DEPTH_MIN, current_depth - 1))
        anti_bloat = "settled or de-escalating evidence outweighed extra-depth requests"

    applied_override = None
    if override:
        o_reason = _normalize_reason(override.get("reason_code", override.get("reason", "")))
        o_evidence = str(override.get("evidence") or "").strip()
        o_depth = _clamp_depth(override.get("next_depth", next_depth), next_depth)
        if o_reason in OVERRIDE_REASONS and _has_evidence(o_evidence):
            next_depth = o_depth
            applied_override = {
                "reason": o_reason,
                "evidence": o_evidence,
                "next_depth": next_depth,
            }
            anti_bloat = "driver override accepted with evidence"
        else:
            applied_override = {
                "ignored": True,
                "reason": o_reason,
                "evidence": o_evidence,
                "next_depth": o_depth,
                "why": "override requires allowed reason and evidence",
            }

    next_depth = _clamp_depth(next_depth, current_depth)
    driver_vote = next((v for v in normalized if v["role"] == "driver"), None)
    positive_pressure = sum(max(0, v["target_depth"] - current_depth) * v["weight"] for v in normalized)
    gate_pressure = max(0, (gate_depth or current_depth) - current_depth)
    depth_pressure = round(positive_pressure + gate_pressure, 4)

    row = {
        "event": "mesh_depth_decision",
        "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "round": round_name,
        "current_depth": current_depth,
        "next_depth": next_depth,
        "current_label": DEPTH_LABELS[current_depth],
        "next_label": DEPTH_LABELS[next_depth],
        "decision": _decision_name(current_depth, next_depth),
        "depth_pressure": depth_pressure,
        "weighted_median_depth": weighted_vote_depth,
        "evidence_epoch": current_evidence_epoch or "",
        "adaptive_profile": profile_for_depth(next_depth),
        "driver_vote": driver_vote,
        "votes": normalized,
        "evidence_gates": sorted(all_gates),
        "override": applied_override,
        "anti_bloat_check": anti_bloat,
    }
    return row


def append_decision(row: dict[str, Any], ledger: str | Path) -> None:
    path = Path(ledger)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(row, sort_keys=True) + "\n")
        f.flush()
        os.fsync(f.fileno())


def _json_arg(value: str | None, default: Any) -> Any:
    if value is None or value == "":
        return default
    p = Path(value)
    if p.exists():
        return json.loads(p.read_text(encoding="utf-8"))
    return json.loads(value)


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Compute a mesh depth escalation decision")
    parser.add_argument("--round", default=os.environ.get("HME_ROUND_NAME", "round"))
    parser.add_argument("--current-depth", type=int)
    parser.add_argument("--votes-json", default="[]", help="JSON array or path to a JSON file")
    parser.add_argument("--votes-from-files-json", default="{}", help="JSON object role->reply-json-file")
    parser.add_argument("--evidence-gates-json", default="[]", help="JSON array or path to a JSON file")
    parser.add_argument("--override-json", default="null", help="JSON object/null or path to a JSON file")
    parser.add_argument("--current-evidence-epoch", default=os.environ.get("HME_MESH_EVIDENCE_EPOCH", ""))
    parser.add_argument("--ledger", default=os.environ.get("HME_ROUND_PROGRESS_FILE", ""))
    parser.add_argument("--append", action="store_true")
    parser.add_argument("--emit-prompt-contract", action="store_true")
    parser.add_argument("--print-profile", type=int)
    ns = parser.parse_args(argv)

    if ns.emit_prompt_contract:
        print(prompt_contract())
        return 0
    if ns.print_profile is not None:
        print(json.dumps(profile_for_depth(ns.print_profile), sort_keys=True))
        return 0
    if ns.current_depth is None:
        raise SystemExit("--current-depth required unless --emit-prompt-contract/--print-profile is used")

    votes = _json_arg(ns.votes_json, [])
    files = _json_arg(ns.votes_from_files_json, {})
    gates = _json_arg(ns.evidence_gates_json, [])
    override = _json_arg(ns.override_json, None)
    if not isinstance(votes, list):
        raise SystemExit("--votes-json must decode to a list")
    if not isinstance(files, dict):
        raise SystemExit("--votes-from-files-json must decode to an object")
    if not isinstance(gates, list):
        raise SystemExit("--evidence-gates-json must decode to a list")
    if override is not None and not isinstance(override, dict):
        raise SystemExit("--override-json must decode to object or null")
    votes = votes + collect_votes_from_reply_files({str(k): str(v) for k, v in files.items()}, ns.current_evidence_epoch or None)

    row = compute_depth_decision(
        current_depth=ns.current_depth,
        votes=votes,
        evidence_gates=gates,
        override=override,
        round_name=ns.round,
        current_evidence_epoch=ns.current_evidence_epoch or None,
    )
    if ns.append:
        if not ns.ledger:
            raise SystemExit("--ledger or HME_ROUND_PROGRESS_FILE required with --append")
        append_decision(row, ns.ledger)
    print(json.dumps(row, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
