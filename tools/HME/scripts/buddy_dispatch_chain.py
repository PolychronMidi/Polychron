"""Buddy dispatch -- `chain` subcommand: run a YAML-defined skill chain on the
buddy. Extracted from buddy_dispatcher.py (was lines 1114-1380). The chain
feature is its own concern: parses chain manifests, validates, sequences
i/<skill> invocations with rate-limit-aware pauses. buddy_dispatcher.py
re-exports the public symbols (cmd_chain, _load_chain_yaml, etc.).
"""
from __future__ import annotations

import argparse
import json
import os
import random
import re
import subprocess
import sys
import time
import uuid
from pathlib import Path

# Project-relative bootstrap (mirrors buddy_dispatcher.py).
PROJECT_ROOT = Path(os.environ.get("PROJECT_ROOT") or Path(__file__).resolve().parents[3])
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
# Pull shared constants + helpers from parent. By the time this module
# loads (via buddy_dispatcher's re-export block), buddy_dispatcher's core
# definitions have already executed, so the cross-module import resolves.
from buddy_dispatcher import (  # noqa: E402
    CHAIN_DIRS, FANOUT_ROOT,
    RATE_LIMIT_JITTER_RANGE, RATE_LIMIT_FALLBACK_BACKOFF_SECONDS,
    _RATE_LIMIT_MODE, _MAX_RATE_LIMIT_PAUSE_SECONDS, _MAX_PAUSES_PER_TASK,
    _ensure_dirs, _strip_ansi, _detect_rate_limit,
    _log_error, _read_guidance,
    _write_manifest, _write_verdict,
)


def _load_chain_yaml(chain_name: str) -> dict | None:
    """Find and parse a chain YAML by name. Searches CHAIN_DIRS in
    order (project-local first, then HME-shipped). Returns None if not
    found. Validation: required fields name / description / version /
    skills, plus mutual exclusion of loop-delay and loop-delay-random."""
    for d in CHAIN_DIRS:
        candidate = d / f"{chain_name}.yaml"
        if not candidate.exists():
            continue
        try:
            import yaml  # PyYAML; ships with most environments
        except ImportError:
            # Lightweight fallback: parse the small subset of YAML we
            # actually use (key: value, key: [a, b], dash lists). Keeps
            # the dispatcher dep-free.
            return _parse_minimal_yaml(candidate.read_text())
        with open(candidate, encoding="utf-8") as f:
            return yaml.safe_load(f)
    return None


def _parse_minimal_yaml(text: str) -> dict:
    """Tiny YAML subset parser: top-level `key: value`, `key: [a, b]`,
    and `key:\\n  - item` lists. Sufficient for chain YAML files which
    are flat by design. Falls back to PyYAML when present (preferred)."""
    out: dict = {}
    lines = text.split("\n")
    i = 0
    while i < len(lines):
        raw = lines[i]
        line = raw.rstrip()
        if not line.strip() or line.lstrip().startswith("#"):
            i += 1
            continue
        # Top-level "key: value" or "key:" (list to follow)
        m = re.match(r"^([a-zA-Z_][a-zA-Z0-9_-]*):\s*(.*)$", line)
        if m:
            key, val = m.group(1), m.group(2).strip()
            if val == "":
                # Block sequence: gather subsequent "  - item" lines
                items = []
                j = i + 1
                while j < len(lines):
                    sub = lines[j]
                    if re.match(r"^\s+-\s+", sub):
                        items.append(sub.strip()[2:].strip())
                        j += 1
                    elif sub.strip() == "" or sub.lstrip().startswith("#"):
                        j += 1
                    else:
                        break
                out[key] = items if items else ""
                i = j
                continue
            # Flow sequence: "key: [a, b, c]"
            if val.startswith("[") and val.endswith("]"):
                inner = val[1:-1].strip()
                if inner:
                    parts = [p.strip().strip("'\"") for p in inner.split(",")]
                    # Coerce numerics
                    coerced = []
                    for p in parts:
                        try:
                            coerced.append(int(p))
                        except ValueError:
                            try:
                                coerced.append(float(p))
                            except ValueError:
                                coerced.append(p)
                    out[key] = coerced
                else:
                    out[key] = []
                i += 1
                continue
            # Scalar -- strip quotes, coerce booleans/numbers
            v = val.strip("'\"")
            if v.lower() in ("true", "yes"):
                out[key] = True
            elif v.lower() in ("false", "no"):
                out[key] = False
            else:
                try:
                    out[key] = int(v)
                except ValueError:
                    try:
                        out[key] = float(v)
                    except ValueError:
                        out[key] = v
            i += 1
            continue
        i += 1
    return out


def _validate_chain(chain: dict) -> str:
    """Return error string if the chain doc is invalid, empty string if OK.

    Validation rules (lifted from skill-set/schema/skill-chain.schema.json):
      - Required fields: name, description, version, skills
      - description: minimum 20 chars (forces specificity -- generic
        descriptions defeat any router that picks chains from a list)
      - version: semver-pattern (X.Y.Z, optional pre-release suffix)
      - skills: non-empty list
      - loop-delay vs loop-delay-random: mutually exclusive
      - on-rate-limit: must be one of {fail, pause, pause-with-cap}
      - Conditional-required: max-rate-limit-pause-seconds requires
        on-rate-limit=pause-with-cap (otherwise meaningless)
    """
    if not isinstance(chain, dict):
        return "chain YAML did not parse to a dict"
    for required in ("name", "description", "version", "skills"):
        if required not in chain:
            return f"missing required field: {required}"
    if not isinstance(chain.get("description"), str) or len(chain["description"].strip()) < 20:
        return "description must be at least 20 chars (forces specificity over generic blurbs)"
    if not isinstance(chain.get("version"), str) or not re.match(r"^\d+\.\d+\.\d+(-[A-Za-z0-9.-]+)?$", chain["version"]):
        return f"version must match semver X.Y.Z[-prerelease]; got {chain.get('version')!r}"
    if not isinstance(chain.get("skills"), list) or len(chain["skills"]) == 0:
        return "skills must be a non-empty list"
    if "loop-delay" in chain and "loop-delay-random" in chain:
        return "loop-delay and loop-delay-random are mutually exclusive"
    if "on-rate-limit" in chain and chain["on-rate-limit"] not in ("fail", "pause", "pause-with-cap"):
        return f"on-rate-limit must be one of fail/pause/pause-with-cap; got {chain['on-rate-limit']!r}"
    if "max-rate-limit-pause-seconds" in chain and chain.get("on-rate-limit") != "pause-with-cap":
        return "max-rate-limit-pause-seconds requires on-rate-limit=pause-with-cap (otherwise unused)"
    return ""


def cmd_chain(args: argparse.Namespace) -> int:
    """Run a chain: load YAML, execute skills sequentially, honor loop
    + loop-delay-random + on-rate-limit semantics. Each skill is a
    Bash command (Polychron's domain -- i/* invocations, npm scripts,
    test runners). The chain runner spawns each as a subprocess in
    sequence; non-zero exit aborts the rest of the chain (same skill-
    set semantics).

    Per-iter manifest at tmp/hme-buddy-fanout/chain-<run-id>/manifest.json.
    """
    chain = _load_chain_yaml(args.chain_name)
    if chain is None:
        searched = " or ".join(str(d) for d in CHAIN_DIRS)
        print(f"chain: {args.chain_name!r} not found in {searched}", file=sys.stderr)
        return 2
    err = _validate_chain(chain)
    if err:
        print(f"chain: invalid {args.chain_name}.yaml -- {err}", file=sys.stderr)
        return 2
    _ensure_dirs()
    loop = int(args.loop) if args.loop is not None else int(chain.get("loop", 1))
    loop_delay = chain.get("loop-delay", 0)
    loop_delay_random = chain.get("loop-delay-random")
    on_rate_limit = args.on_rate_limit or chain.get("on-rate-limit", _RATE_LIMIT_MODE)
    skills = chain["skills"]
    run_id = f"chain-{int(time.time())}-{uuid.uuid4().hex[:6]}"
    manifest = {
        "run_id": run_id,
        "chain_name": chain["name"],
        "chain_version": chain.get("version", "?"),
        "started_ts": time.time(),
        "loop": {"requested": loop, "completed": 0, "terminated_by": "in_progress"},
        "iterations": [],
        "on_rate_limit": on_rate_limit,
    }
    _write_manifest(run_id, manifest, in_progress=True)
    iter_n = 0
    pause_count = 0
    while loop == 0 or iter_n < loop:
        iter_n += 1
        iter_record = {"iter": iter_n, "started_ts": time.time(), "skills": []}
        aborted_in_iter = False
        for skill_idx, skill_cmd in enumerate(skills):
            skill_record = {
                "idx": skill_idx, "command": skill_cmd, "started_ts": time.time(),
            }
            attempt = 0
            while True:
                attempt += 1
                rc, stdout, stderr, elapsed = _run_skill(skill_cmd)
                if rc != 0 and on_rate_limit != "fail":
                    rl = _detect_rate_limit(stderr, stdout)
                    if rl and rl["detected"]:
                        pause_count += 1
                        if pause_count > _MAX_PAUSES_PER_TASK:
                            skill_record["outcome"] = "max_pauses_exceeded"
                            skill_record["pauses"] = pause_count
                            break
                        sleep_s = _compute_pause_seconds(rl, on_rate_limit)
                        if sleep_s is None:
                            skill_record["outcome"] = "rate_limit_pause_capped"
                            skill_record["pauses"] = pause_count
                            break
                        _log_error(f"chain: {chain['name']} skill[{skill_idx}] hit rate limit; sleeping {sleep_s:.0f}s")
                        time.sleep(sleep_s)
                        continue  # retry same skill
                # Final outcome (success or non-rate-limit failure)
                skill_record["outcome"] = "done" if rc == 0 else "failed"
                skill_record["rc"] = rc
                skill_record["elapsed_s"] = round(elapsed, 2)
                skill_record["stdout_tail"] = stdout[-1500:]
                skill_record["stderr_tail"] = stderr[-1000:]
                skill_record["attempts"] = attempt
                break
            iter_record["skills"].append(skill_record)
            _write_manifest(run_id, manifest, in_progress=True)
            if skill_record.get("outcome") != "done":
                aborted_in_iter = True
                manifest["loop"]["terminated_by"] = f"skill_{skill_record['outcome']}"
                break
        iter_record["finished_ts"] = time.time()
        manifest["iterations"].append(iter_record)
        manifest["loop"]["completed"] = iter_n
        _write_manifest(run_id, manifest, in_progress=True)
        if aborted_in_iter:
            break
        # Inter-iter delay
        if loop_delay_random and isinstance(loop_delay_random, list) and len(loop_delay_random) == 2:
            delay = random.uniform(float(loop_delay_random[0]), float(loop_delay_random[1]))
            time.sleep(delay)
        elif loop_delay:
            time.sleep(float(loop_delay))
    if manifest["loop"]["terminated_by"] == "in_progress":
        manifest["loop"]["terminated_by"] = "loop_complete"
    manifest["finished_ts"] = time.time()
    _write_manifest(run_id, manifest, in_progress=False)
    verdict_path = _write_verdict(run_id, {**manifest, "drained_count": sum(len(it["skills"]) for it in manifest["iterations"]), "buddies": []})
    print(f"chain: {chain['name']} ran {iter_n} iter(s); terminated_by={manifest['loop']['terminated_by']}")
    print(f"  manifest: {FANOUT_ROOT / run_id / 'manifest.json'}")
    print(f"  verdict:  {verdict_path}")
    return 0 if manifest["loop"]["terminated_by"] in ("loop_complete", "no_work_bail") else 1


def _run_skill(cmd: str) -> tuple[int, str, str, float]:
    """Spawn a chain skill (a Bash command) as a subprocess. Returns
    (rc, stdout, stderr, elapsed_s). ANSI stripped at sink-time so
    color codes don't pollute the on-disk manifest."""
    started = time.time()
    try:
        proc = subprocess.run(
            ["bash", "-c", cmd],
            capture_output=True, text=True,
            env={**os.environ, "HME_THREAD_CHILD": "1"},
            cwd=str(PROJECT_ROOT),
        )
        return (
            proc.returncode,
            _strip_ansi(proc.stdout or ""),
            _strip_ansi(proc.stderr or ""),
            time.time() - started,
        )
    except Exception as e:
        return -1, "", f"_run_skill exception: {e}", time.time() - started


def _compute_pause_seconds(rl: dict, mode: str) -> float | None:
    """Determine pause duration from rate-limit detection. Returns None
    if mode='pause-with-cap' AND the would-be pause exceeds the cap
    (caller treats as final failure)."""
    now = time.time()
    if rl.get("reset_epoch"):
        sleep_s = max(0.0, rl["reset_epoch"] - now)
        sleep_s += random.uniform(*RATE_LIMIT_JITTER_RANGE)
    else:
        sleep_s = RATE_LIMIT_FALLBACK_BACKOFF_SECONDS + random.uniform(*RATE_LIMIT_JITTER_RANGE)
    if mode == "pause-with-cap" and sleep_s > _MAX_RATE_LIMIT_PAUSE_SECONDS:
        return None
    return sleep_s

