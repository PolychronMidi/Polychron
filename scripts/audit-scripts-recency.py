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
SOURCE_SKIP_PREFIXES = ("log/", "output/", "runtime/", "tmp/", "tools/models/")
RUN_SUFFIXES = {".py", ".js", ".sh"}


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
            c = body.count(rel)
            if c:
                count += c
                if len(samples) < 3:
                    samples.append(str(f.relative_to(ROOT)))
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


def log_observations(paths: list[Path]) -> dict[Path, tuple[float, str]]:
    logs: list[Path] = []
    for root in LOG_ROOTS:
        if not root.exists():
            continue
        for p in root.rglob("*"):
            if p.is_file() and p.stat().st_size <= 20_000_000:
                logs.append(p)
    obs: dict[Path, tuple[float, str]] = {}
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
                ts = log.stat().st_mtime
                if p not in obs or ts > obs[p][0]:
                    obs[p] = (ts, str(log.relative_to(ROOT)))
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
        rows.append((p in obs, obs.get(p, (0, ""))[0], ref_count, str(p.relative_to(ROOT)), samples, obs.get(p, (0, ""))[1]))
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
