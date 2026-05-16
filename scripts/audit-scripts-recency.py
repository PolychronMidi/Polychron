#!/usr/bin/env python3
"""Rank scripts/ files by observed run/reference recency.

Report-only by default. Strict mode fails only on broken script wiring
(missing pipeline command paths or broken symlink targets), not on cold files.
"""
from __future__ import annotations

import argparse
import os
import re
import shlex
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT_ROOT = ROOT / "scripts"
LOG_ROOTS = [ROOT / "log", ROOT / "output" / "metrics", ROOT / "runtime" / "hme"]
RUN_EVIDENCE_METRICS = {"hme-activity.jsonl", "hme-activity-archive.jsonl", "hme-tool-usage.jsonl"}
SOURCE_SKIP_PREFIXES = ("log/", "output/", "runtime/", "tmp/", "tools/models/")
RUN_SUFFIXES = {".py", ".js", ".sh"}

COLD_CLASSIFICATIONS = {
    "scripts/hme/codex-agent-job.py": "manual Codex filesystem job launcher",
    "scripts/hme/timeline-panel.py": "i/status timeline panel",
    "scripts/hme/freeze-check.py": "i/why mode=freeze panel",
    "scripts/probe-omniroute-max-reasoning.py": "provider-manifest OmniRoute check",
    "scripts/sync-omniroute-model-limits.py": "doctor/admin OmniRoute sync",
    "scripts/configure-omniroute-max-reasoning.py": "OmniRoute startup/admin config",
    "scripts/c2m.py": "render/lab MIDI conversion utility",
    "scripts/compact-lance-tables.py": "pipeline/lifecycle LanceDB maintenance",
    "scripts/sync-claude-settings.py": "Claude settings sync admin check",
    "scripts/pipeline/train-verdict-predictor.js": "post-composition trainer; audit --check",
    "scripts/pipeline/hme/utils.js": "shared HME pipeline helper module",
}


def git_files(prefix: str = "") -> list[Path]:
    cmd = ["git", "ls-files"] + ([prefix] if prefix else [])
    out = subprocess.check_output(cmd, cwd=ROOT, text=True)
    return [ROOT / line for line in out.splitlines() if line]


def is_script(path: Path) -> bool:
    return path.suffix in RUN_SUFFIXES or os.access(path, os.X_OK)


def text(path: Path) -> str:
    try:
        return path.read_text(errors="replace")
    except OSError:
        return ""


def broken_symlinks(paths: list[Path]) -> list[str]:
    return [str(p.relative_to(ROOT)) for p in paths if p.is_symlink() and not p.exists()]


def pipeline_missing() -> list[str]:
    p = ROOT / "scripts" / "pipeline" / "main-pipeline.js"
    missing: list[str] = []
    for cmd in re.findall(r"cmd:\s*'([^']+)'", text(p)):
        try:
            parts = shlex.split(cmd)
        except ValueError as exc:
            missing.append(f"{cmd} :: shlex {exc}")
            continue
        for part in parts:
            if part.startswith("scripts/") and not any(ch in part for ch in "*?"):
                if not (ROOT / part).exists():
                    missing.append(f"{part} <= {cmd}")
    return missing


def _sample(samples: list[str], path: Path) -> None:
    rel = str(path.relative_to(ROOT))
    if len(samples) < 3 and rel not in samples:
        samples.append(rel)


def _py_local_import_count(target: Path, source: Path, body: str) -> int:
    if target.suffix != ".py" or source.suffix != ".py" or target.parent != source.parent:
        return 0
    stem = target.stem
    if not re.fullmatch(r"[A-Za-z_]\w*", stem):
        return 0
    from_import = rf"(?m)^\s*from\s+\.?{re.escape(stem)}\s+import\s+"
    direct_import = rf"(?m)^\s*import\s+.*(?:^|,\s*){re.escape(stem)}(?:\s+as\s+\w+)?(?:\s*,|\s*$)"
    return len(re.findall(from_import, body)) + len(re.findall(direct_import, body))


def _js_local_import_count(target: Path, source: Path, body: str) -> int:
    if target.suffix != ".js" or source.suffix not in {".js", ".mjs", ".cjs"}:
        return 0
    rel = os.path.relpath(target, source.parent).replace(os.sep, "/")
    if not rel.startswith("."):
        rel = "./" + rel
    specs = {rel, rel.removesuffix(target.suffix)}
    total = 0
    for spec in specs:
        q = re.escape(spec)
        patterns = [
            rf"require\(\s*['\"]{q}['\"]\s*\)",
            rf"from\s+['\"]{q}['\"]",
            rf"import\(\s*['\"]{q}['\"]\s*\)",
        ]
        total += sum(len(re.findall(pattern, body)) for pattern in patterns)
    return total


def _local_import_count(target: Path, source: Path, body: str) -> int:
    return _py_local_import_count(target, source, body) + _js_local_import_count(target, source, body)


def source_reference_counts(paths: list[Path]) -> dict[Path, tuple[int, list[str]]]:
    all_files = [p for p in git_files() if not str(p.relative_to(ROOT)).startswith(SOURCE_SKIP_PREFIXES)]
    refs: dict[Path, tuple[int, list[str]]] = {}
    for target in paths:
        rel = str(target.relative_to(ROOT))
        count = 0
        samples: list[str] = []
        for f in all_files:
            if f == target:
                continue
            body = text(f)
            c = body.count(rel) + _local_import_count(target, f, body)
            if c:
                count += c
                _sample(samples, f)
        if str(target.relative_to(ROOT)).startswith('scripts/eslint-rules/') and target.name not in {'index.js'}:
            stem = target.stem
            idx = text(ROOT / 'scripts' / 'eslint-rules' / 'index.js')
            cfg = text(ROOT / 'eslint.config.mjs')
            if f"require('./{stem}')" in idx:
                count += 1
                if len(samples) < 3:
                    samples.append('scripts/eslint-rules/index.js')
            if f'local/{stem}' in cfg:
                count += 1
                if len(samples) < 3:
                    samples.append('eslint.config.mjs')
        refs[target] = (count, samples)
    return refs


def _is_run_evidence_log(path: Path) -> bool:
    rel = str(path.relative_to(ROOT))
    if rel.startswith("log/"):
        return path.suffix in {".log", ".out", ".jsonl"} or path.name.startswith("hme.log")
    if rel.startswith("output/metrics/archive/"):
        return path.name.startswith("hme-activity") and path.suffix == ".archive"
    if rel.startswith("output/metrics/"):
        return path.name in RUN_EVIDENCE_METRICS
    if rel.startswith("runtime/hme/"):
        return path.suffix == ".jsonl"
    return False


def _configured_eslint_rules() -> set[str]:
    cfg = text(ROOT / "eslint.config.mjs")
    return {m.group(1) for m in re.finditer(r'local/([a-z0-9-]+)[\'"]\s*:', cfg)}


def _main_pipeline_commands() -> dict[str, str]:
    out: dict[str, str] = {}
    p = ROOT / "scripts" / "pipeline" / "main-pipeline.js"
    for label, cmd in re.findall(r"label:\s*'([^']+)'\s*,\s*cmd:\s*'([^']+)'", text(p)):
        for part in shlex.split(cmd):
            if part.startswith("scripts/") and not any(ch in part for ch in "*?"):
                out[part] = label
    return out


def _record(obs: dict[Path, tuple[float, str]], path: Path, ts: float, source: str) -> None:
    if path not in obs or ts > obs[path][0]:
        obs[path] = (ts, source)


def log_observations(paths: list[Path]) -> dict[Path, tuple[float, str]]:
    logs: list[Path] = []
    for root in LOG_ROOTS:
        if not root.exists():
            continue
        for p in root.rglob("*"):
            if p.is_file() and p.stat().st_size <= 20_000_000 and _is_run_evidence_log(p):
                logs.append(p)
    obs: dict[Path, tuple[float, str]] = {}
    rel_to_path = {str(p.relative_to(ROOT)): p for p in paths}
    for p in paths:
        rel = str(p.relative_to(ROOT))
        needles = {rel, "./" + rel, str(p)}
        if p.is_symlink():
            try:
                needles.add(str(p.resolve()))
            except OSError:
                pass
        for log in logs:
            body = text(log)
            if any(n in body for n in needles):
                _record(obs, p, log.stat().st_mtime, str(log.relative_to(ROOT)))
    lint_log = ROOT / "log" / "lint.log"
    if lint_log.exists():
        configured = _configured_eslint_rules()
        for rel, p in rel_to_path.items():
            if rel.startswith("scripts/eslint-rules/") and p.stem in configured:
                _record(obs, p, lint_log.stat().st_mtime, "log/lint.log")
    pipeline_log = ROOT / "log" / "pipeline.log"
    if pipeline_log.exists():
        body = text(pipeline_log)
        for rel, label in _main_pipeline_commands().items():
            p = rel_to_path.get(rel)
            if p and (label in body or rel in body):
                _record(obs, p, pipeline_log.stat().st_mtime, "log/pipeline.log")
    return obs


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=40)
    ap.add_argument("--strict", action="store_true")
    args = ap.parse_args()

    scripts = [p for p in git_files("scripts") if p.is_file() and is_script(p)]
    refs = source_reference_counts(scripts)
    obs = log_observations(scripts)
    broken = broken_symlinks([p for p in git_files("scripts") if p.is_symlink()])
    missing = pipeline_missing()

    rows = []
    for p in scripts:
        ref_count, samples = refs[p]
        rel = str(p.relative_to(ROOT))
        rows.append((p in obs, obs.get(p, (0, ""))[0], ref_count, rel, samples, obs.get(p, (0, ""))[1], COLD_CLASSIFICATIONS.get(rel, "")))
    rows.sort(key=lambda r: (r[0], r[1], r[2], r[3]))

    print(f"audit-scripts-recency: scripts={len(scripts)} observed={sum(1 for p in scripts if p in obs)} cold={sum(1 for p in scripts if p not in obs)}")
    if broken:
        print("BROKEN_SYMLINKS:")
        for item in broken:
            print(f"  - {item}")
    if missing:
        print("MISSING_PIPELINE_PATHS:")
        for item in missing:
            print(f"  - {item}")
    print("COLDEST:")
    for observed, _ts, ref_count, rel, samples, source in rows[:args.limit]:
        status = "observed" if observed else "never-observed"
        suffix = f" last_seen={source}" if source else ""
        print(f"  {status:14} refs={ref_count:3} {rel}{suffix}")
        if samples:
            print(f"    refs: {', '.join(samples)}")
    return 1 if args.strict and (broken or missing) else 0


if __name__ == "__main__":
    raise SystemExit(main())
