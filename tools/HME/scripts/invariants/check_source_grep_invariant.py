#!/usr/bin/env python3
"""Source grep invariants with stable Python-side allowlists."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
from pathlib import Path

ROOT = Path(os.environ.get("PROJECT_ROOT") or Path(__file__).resolve().parents[4])

RULES = {
    "no-mcp-side-timeouts-synthesis": [
        {
            "paths": [
                "tools/HME/service/server/tools_analysis/synthesis_llamacpp.py",
                "tools/HME/service/server/tools_analysis/synthesis_pipeline.py",
                "tools/HME/service/server/tools_analysis/synthesis_warm.py",
                "tools/HME/service/server/tools_analysis/evolution_suggest.py",
                "tools/HME/service/server/tools_analysis/workflow_audit.py",
            ],
            "pattern": r"join\(timeout=",
        },
        {
            "paths": [
                "tools/HME/service/server/tools_analysis/synthesis_llamacpp.py",
                "tools/HME/service/server/tools_analysis/synthesis_warm.py",
                "tools/HME/service/server/tools_analysis/synthesis_pipeline.py",
            ],
            "pattern": r"urlopen\([^)]*_LLAMACPP_(ARBITER|CODER)_URL",
            "exclude": r"/health|/api/ps|# preemption-ok",
        },
    ],
    "hme-py-no-os-environ": [{"roots": ["tools/HME/service"], "include": [".py"], "pattern": r"os\.environ", "exclude": r"__pycache__|hme_env\.py|tools/HME/service/tests/|# env-ok"}],
    "hme-py-no-hardcoded-home": [{"roots": ["tools/HME/service", "tools/HME/hooks", "tools/HME/scripts", "tools/HME/activity", "tools/HME/proxy"], "include": [".py", ".sh", ".js"], "pattern": r"/home/jah", "exclude": r"__pycache__|\.log:|# path-ok"}],
    "no-hardcoded-llamacpp-ports": [{"roots": ["tools/HME/service/server"], "include": [".py"], "pattern": r"localhost:1143[4-6]|127\.0\.0\.1:1143[4-6]", "exclude": r"HME_LLAMACPP_PORT|# llamacpp-legacy-ok"}],
    "conductor-no-or-zero-on-validator-output": [{"roots": ["src"], "include": [".js"], "pattern": r"(V\.optionalFinite\([^)]*,[^)]*\)|safePreBoot\.call\([^)]*,[^)]*\))\s*\|\|"}],
    "conductor-histogram-uses-nullish": [{"roots": ["src/conductor"], "include": [".js"], "pattern": r"\.get\([^)]*\)\s*\|\|\s*0\b", "exclude": r"//.*nullish|\.size"}],
    "hme-no-raw-os-environ": [{"roots": ["tools/HME/service"], "include": [".py"], "pattern": r"os\.environ\.get\(", "exclude": r"hme_env\.py|tools/HME/service/tests/|__pycache__|\.log|\.jsonl|^\s*#|env\[.*\] = os\.environ|# env-ok"}],
    "no-hardcoded-metrics-path": [{"roots": ["."], "include": [".js", ".py", ".sh"], "pattern": r"['\"]metrics/|path\.join\([^)]*['\"]metrics['\"]|os\.path\.join\([^)]*['\"]metrics['\"]", "exclude": r"# metrics-ok|output/metrics|scripts/migrate-metrics-path\.py|tools/HME/KB/|tools/HME/tests/", "skip_dirs": {"node_modules", ".git", "__pycache__", ".venv"}}],
    "daemon-is-gpu-authority": [{"roots": ["tools/HME/service"], "include": [".py"], "pattern": r"\"cuda:[0-9]\"", "exclude": r"__pycache__|llamacpp_daemon\.py|rag_engines\.py|rag_engine/engine\.py|vram_manager\.py|# device-ok"}],
    "hme-py-valueerror-coverage": [{"paths": ["tools/HME/service/server/operational_state.py"], "pattern": r"except \(OSError", "exclude": r"ValueError"}],
    "index-directory-zero-args": [{"paths": ["tools/HME/service/rag_engine/engine_indexing.py"], "pattern": r"def index_directory\(self,|def _index_directory_locked\(self,|def _collect_files\(self,"}],
    "no-direct-gpu-model-load-in-indexing": [{"paths": ["tools/HME/service/indexing_mode.py", "tools/HME/service/server/tools_index.py"], "pattern": r"from sentence_transformers|import torch|SentenceTransformer"}],
    "event-kernel-subprocesses-use-fs-ipc": [{"roots": ["tools/HME/event_kernel", "tools/HME/proxy/stop_chain"], "include": [".js"], "pattern": r"child\.stdin|stdin\.write|spawnSync\([^\n]*input"}],
    "overdrive-no-stale-mode6": [
        {
            "roots": [
                "tools/HME/launcher",
                "tools/HME/hooks",
                "tools/HME/proxy",
                "tools/HME/service",
                "tools/HME/scripts",
                "tools/HME/config",
                "doc",
            ],
            "include": [".js", ".py", ".sh", ".md", ".json"],
            "pattern": r"OVERDRIVE_MODE=6|MODE=6|mode 6|_mode6|mode6|buildMode6|resolve_mode6|_OD_START.*[\"']6",
            "exclude": r"tools/HME/KB/|tools/HME/tests/|tools/HME/config/invariants/|tools/HME/scripts/invariants/check_source_grep_invariant\.py|__pycache__|node_modules/",
        },
        {
            "paths": [".env"],
            "pattern": r"OVERDRIVE_MODE=6|MODE=6|mode 6|_mode6|mode6|buildMode6|resolve_mode6|_OD_START.*[\"']6",
        },
    ],
}


def _baseline_hash(rel: str, line: str) -> str:
    return hashlib.sha256(f"{rel}\0{line.strip()}".encode()).hexdigest()


BASELINE_FILES = {
    "no-hardcoded-metrics-path": "tools/HME/config/invariants/hardcoded_metrics_baseline.json",
}


def _load_baseline_doc(rule_name: str) -> dict:
    rel = BASELINE_FILES.get(rule_name)
    if not rel:
        return {}
    path = ROOT / rel
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def _load_baseline(rule_name: str) -> set[str]:
    hashes = _load_baseline_doc(rule_name).get("hashes")
    return set(hashes) if isinstance(hashes, list) else set()


def _candidate_files(rule: dict):
    if "paths" in rule:
        for rel in rule["paths"]:
            path = ROOT / rel
            if path.is_file():
                yield path
        return
    include = set(rule.get("include") or [])
    skip_dirs = set(rule.get("skip_dirs") or set())
    for root_rel in rule.get("roots") or []:
        root = ROOT / root_rel
        if root.is_file():
            yield root
            continue
        if not root.is_dir():
            continue
        for path in root.rglob("*"):
            if not path.is_file():
                continue
            rel_parts = set(path.relative_to(ROOT).parts)
            if skip_dirs & rel_parts:
                continue
            if include and path.suffix not in include:
                continue
            yield path


def _findings(rule_name: str) -> list[tuple[str, int, str, str]]:
    found: list[tuple[str, int, str, str]] = []
    for rule in RULES[rule_name]:
        pattern = re.compile(rule["pattern"])
        exclude = re.compile(rule["exclude"]) if rule.get("exclude") else None
        for path in _candidate_files(rule):
            rel = path.relative_to(ROOT).as_posix()
            text = path.read_text(encoding="utf-8", errors="replace")
            for lineno, line in enumerate(text.splitlines(), 1):
                row = f"{rel}:{lineno}:{line}"
                if not pattern.search(line) or (exclude and exclude.search(row)):
                    continue
                found.append((rel, lineno, line, _baseline_hash(rel, line)))
    return found


def _baseline_stats(rule_name: str) -> dict:
    baseline_doc = _load_baseline_doc(rule_name)
    baseline = set(baseline_doc.get("hashes") or [])
    findings = _findings(rule_name)
    current = {h for *_rest, h in findings}
    used = current & baseline
    new = current - baseline
    stale = baseline - current
    return {
        "rule": rule_name,
        "baseline_file": BASELINE_FILES.get(rule_name, ""),
        "initial_count": int(baseline_doc.get("initial_count", baseline_doc.get("count", len(baseline))) or 0),
        "baseline_count": len(baseline),
        "current_count": len(current),
        "used_baseline_count": len(used),
        "stale_baseline_count": len(stale),
        "new_count": len(new),
    }


def _parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("rule", choices=sorted(RULES))
    parser.add_argument("--baseline-stats", action="store_true")
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--include-baseline", action="store_true")
    return parser.parse_args(argv)


def main() -> int:
    args = _parse_args(sys.argv[1:])
    rule_name = args.rule
    if args.baseline_stats:
        stats = _baseline_stats(rule_name)
        if args.json:
            print(json.dumps(stats, sort_keys=True))
        else:
            print(
                f"{rule_name}: current={stats['current_count']} "
                f"baseline={stats['baseline_count']} used={stats['used_baseline_count']} "
                f"stale={stats['stale_baseline_count']} new={stats['new_count']}"
            )
        return 0
    baseline = set() if args.include_baseline else _load_baseline(rule_name)
    for rel, lineno, line, digest in _findings(rule_name):
        if digest in baseline:
            continue
        print(f"{rel}:{lineno}:{line}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
