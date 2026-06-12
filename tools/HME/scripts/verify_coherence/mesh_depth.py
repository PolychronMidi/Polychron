"""Mesh depth-vote contract verifier."""
from __future__ import annotations

import json
import os

from ._base import VerdictResult, Verifier, _PROJECT, failed, passed, register


@register
class MeshDepthDecisionContractVerifier(Verifier):
    """First-class mesh rounds must use the evidence-weighted depth contract.

    This protects the debate-hall design from regressing into popularity voting,
    unlogged ceremony, or manual-only escalation.
    """
    name = "mesh-depth-decision-contract"
    category = "coverage"
    subtag = "interface-contract"
    weight = 2.0

    def run(self) -> VerdictResult:
        rels = {
            "decision": "teams/rounds/depth_decision.py",
            "policy": "teams/rounds/depth_policy.json",
            "progress": "teams/rounds/_progress.sh",
            "runner": "teams/rounds/round_measured.sh",
            "status": "teams/rounds/round_status.py",
            "test": "tools/HME/tests/specs/depth_decision.test.py",
            "runner_test": "tools/HME/tests/specs/round_runner_contract.test.py",
        }
        errors: list[str] = []
        texts: dict[str, str] = {}
        for key, rel in rels.items():
            path = os.path.join(_PROJECT, rel)
            if not os.path.exists(path):
                errors.append(f"missing {rel}")
                continue
            try:
                with open(path, encoding="utf-8") as f:
                    texts[key] = f.read()
            except OSError as e:
                errors.append(f"unreadable {rel}: {e}")

        try:
            with open(os.path.join(_PROJECT, rels["policy"]), encoding="utf-8") as f:
                policy = json.load(f)
        except Exception as e:
            policy = {}
            errors.append(f"depth_policy.json invalid: {e}")
        profiles = policy.get("escalation_profiles") or {}
        for depth in map(str, range(6)):
            if depth not in profiles:
                errors.append(f"depth_policy missing escalation profile {depth}")
        if "guard_surface" not in (policy.get("gate_min_depth") or {}):
            errors.append("depth_policy must define guard_surface gate")

        checks = [
            ("decision", "prompt_contract", "depth_decision must emit peer vote prompt contract"),
            ("decision", "collect_votes_from_reply_files", "depth_decision must collect votes from peer reply files"),
            ("decision", "current_evidence_epoch", "depth_decision must support vote freshness epochs"),
            ("decision", "profile_for_depth", "depth_decision must expose adaptive autonomy profiles"),
            ("decision", "weighted_median", "depth_decision must resist raw popularity sums"),
            ("progress", "progress_depth_decision_from_files", "progress helper must append depth decisions from replies"),
            ("progress", "HME_MESH_DRIVER_VOTE_JSON", "progress helper must allow driver vote input"),
            ("runner", "--emit-prompt-contract", "round runner must request structured depth votes"),
            ("runner", "progress_depth_decision_from_files", "round runner must persist mesh_depth_decision rows"),
            ("runner", "HME_MESH_AUTO_ESCALATE", "round runner must support bounded auto-escalation"),
            ("runner", "progress_set_total", "round runner must adjust progress total for adaptive extra turns"),
            ("runner", "HME_MESH_ACTIVE_MAX_TOOLS", "round runner must map decision profile to tool autonomy"),
            ("runner", "m_debate.json", "round runner must execute debate-hall escalation turn"),
            ("status", "mesh_depth_decision", "round_status must render depth decision rows"),
            ("test", "test_stale_vote_epoch_zeroes_weight", "tests must cover stale vote freshness"),
            ("test", "test_collect_votes_from_reply_files", "tests must cover vote extraction from replies"),
            ("runner_test", "progress_depth_decision_from_files", "runner tests must bind adaptive depth contract"),
        ]
        for key, needle, msg in checks:
            if needle not in texts.get(key, ""):
                errors.append(msg)

        if errors:
            score = max(0.0, 1.0 - len(errors) / max(1, len(checks) + 8))
            return failed(score=score, summary=f"{len(errors)} mesh depth contract issue(s)", details=errors)
        return passed(summary="mesh depth voting contract wired: policy, runner, ledger, status, tests")
