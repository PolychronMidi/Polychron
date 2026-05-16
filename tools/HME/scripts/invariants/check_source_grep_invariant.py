#!/usr/bin/env python3
"""Source grep invariants with stable Python-side allowlists."""
from __future__ import annotations

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
    "no-hardcoded-metrics-path": [{"roots": ["."], "include": [".js", ".py", ".sh"], "pattern": r"['\"]metrics/|path\.join\([^)]*['\"]metrics['\"]|os\.path\.join\([^)]*['\"]metrics['\"]", "exclude": r"# metrics-ok|output/metrics|scripts/migrate-metrics-path\.py|tools/HME/KB/", "skip_dirs": {"node_modules", ".git", "__pycache__", ".venv"}}],
    "daemon-is-gpu-authority": [{"roots": ["tools/HME/service"], "include": [".py"], "pattern": r"\"cuda:[0-9]\"", "exclude": r"__pycache__|llamacpp_daemon\.py|rag_engines\.py|rag_engine/engine\.py|vram_manager\.py|# device-ok"}],
}


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


def main() -> int:
    if len(sys.argv) != 2 or sys.argv[1] not in RULES:
        print("usage: check_source_grep_invariant.py <rule>", file=sys.stderr)
        print("rules: " + ", ".join(sorted(RULES)), file=sys.stderr)
        return 2
    for rule in RULES[sys.argv[1]]:
        pattern = re.compile(rule["pattern"])
        exclude = re.compile(rule["exclude"]) if rule.get("exclude") else None
        for path in _candidate_files(rule):
            rel = path.relative_to(ROOT).as_posix()
            text = path.read_text(encoding="utf-8", errors="replace")
            for lineno, line in enumerate(text.splitlines(), 1):
                row = f"{rel}:{lineno}:{line}"
                if pattern.search(line) and not (exclude and exclude.search(row)):
                    print(row)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
