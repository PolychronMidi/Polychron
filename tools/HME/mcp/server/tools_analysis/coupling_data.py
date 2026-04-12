"""Coupling data loading — trust scores, coupling state, module detection, Pearson correlation."""
import json
import os
import re
from collections import defaultdict
import logging

from server import context as ctx

logger = logging.getLogger("HME")

# Trust system name -> crossLayer file name aliases
_TRUST_FILE_ALIASES: dict[str, str] = {
    "climaxEngine": "crossLayerClimaxEngine",
    "roleSwap": "dynamicRoleSwap",
    "restSync": "restSynchronizer",
    "phaseLock": "rhythmicPhaseLock",
    "convergence": "convergenceDetector",
    "dynamicEnvelope": "crossLayerDynamicEnvelope",
    "rhythmicComplement": "rhythmicComplementEngine",
    "motifEcho": "motifEcho",
}
_FILE_TRUST_ALIASES: dict[str, str] = {v: k for k, v in _TRUST_FILE_ALIASES.items()}

ALL_RHYTHM_FIELDS = ["densitySurprise", "hotspots", "complexityEma", "biasStrength", "complexity", "density"]
ALL_MELODIC_DIMS = ["contourShape", "registerMigrationDir", "tessituraLoad", "thematicDensity",
                    "counterpoint", "intervalFreshness", "ascendRatio", "freshnessEma"]


def _pearson(xs: list, ys: list) -> float:
    """Compute Pearson correlation without numpy."""
    n = len(xs)
    if n < 10:
        return 0.0
    sx = sum(xs)
    sy = sum(ys)
    sx2 = sum(x * x for x in xs)
    sy2 = sum(y * y for y in ys)
    sxy = sum(x * y for x, y in zip(xs, ys))
    num = n * sxy - sx * sy
    denom_sq = (n * sx2 - sx ** 2) * (n * sy2 - sy ** 2)
    if denom_sq <= 0:
        return 0.0
    return num / (denom_sq ** 0.5)


_coupling_cache: dict = {"result": {}, "ts": 0.0}
_COUPLING_CACHE_TTL = 120.0


def _scan_coupling_state(src_root: str) -> dict:
    """Return per-module coupling state for all crossLayer JS files. Cached 120s."""
    import time as _time
    now = _time.monotonic()
    if _coupling_cache["result"] and (now - _coupling_cache["ts"]) < _COUPLING_CACHE_TTL:
        return _coupling_cache["result"]
    cl_dir = os.path.join(src_root, "crossLayer")
    results = {}
    if not os.path.isdir(cl_dir):
        return results

    for dirpath, _, filenames in os.walk(cl_dir):
        for fname in filenames:
            if not fname.endswith(".js") or fname == "index.js":
                continue
            fpath = os.path.join(dirpath, fname)
            try:
                with open(fpath, encoding="utf-8", errors="ignore") as f:
                    content = f.read()
            except Exception:
                continue

            module_name = fname.replace(".js", "")

            melodic_coupled = "emergentMelodicEngine" in content
            rhythm_coupled = (
                "emergentRhythmEngine" in content
                or "L0.getLast('emergentRhythm'" in content
                or 'L0.getLast("emergentRhythm"' in content
                or "L0_CHANNELS.emergentRhythm" in content
            )
            phase_coupled = "rhythmicPhaseLock.getMode()" in content

            melodic_dims: list[str] = []
            if melodic_coupled:
                dims = re.findall(r'melodicCtx\w*\s*(?:\?\.|\.)(\w+)', content)
                melodic_dims = sorted(d for d in set(dims)
                                      if d not in {"call", "getContext", "getMelodicWeights",
                                                   "getContourAscendBias", "nudgeNoveltyWeight"})

            _KNOWN_RHYTHM_FIELDS = {"density", "complexity", "biasStrength", "densitySurprise", "hotspots", "complexityEma"}
            rhythm_dims: list[str] = []
            if rhythm_coupled:
                dims = re.findall(r'rhythmCtx\w*\s*(?:\?\.|\.)(\w+)', content)
                dims += re.findall(r'rhythmEntry\w*\.(\w+)', content)
                dims += re.findall(r'emergentEntry\w*\.(\w+)', content)
                rhythm_dims = sorted(d for d in set(dims) if d in _KNOWN_RHYTHM_FIELDS)

            results[module_name] = {
                "path": fpath,
                "melodic": melodic_coupled,
                "melodic_dims": melodic_dims,
                "rhythm": rhythm_coupled,
                "rhythm_dims": rhythm_dims,
                "phase": phase_coupled,
            }

    _coupling_cache["result"] = results
    _coupling_cache["ts"] = now
    return results


def _load_trust_scores(project_root: str) -> dict:
    """Load ALL per-module trust scores from trace-summary.json."""
    summary_path = os.path.join(project_root, "metrics", "trace-summary.json")
    if not os.path.isfile(summary_path):
        return {}
    try:
        with open(summary_path) as f:
            summary = json.load(f)
        score_abs = summary.get("trustScoreAbs", {})
        if isinstance(score_abs, dict) and score_abs:
            return {name: round(data.get("avg", 0), 3)
                    for name, data in score_abs.items()
                    if isinstance(data, dict)}
        dom = summary.get("trustDominance", {})
        if isinstance(dom, dict):
            systems = dom.get("dominantSystems", [])
            return {s["system"]: round(s.get("score", 0), 3)
                    for s in systems if isinstance(s, dict) and "system" in s}
        return {}
    except Exception:
        return {}


def _detect_traced_modules(project_root: str) -> set:
    """Return set of module names that appear in trace.jsonl trust data."""
    trace_path = os.path.join(project_root, "metrics", "trace.jsonl")
    found: set = set()
    if not os.path.isfile(trace_path):
        return found
    try:
        with open(trace_path, encoding="utf-8") as f:
            for i, line in enumerate(f):
                if i > 20:
                    break
                rec = json.loads(line)
                for sys_name in rec.get("trust", {}):
                    found.add(sys_name)
                    if sys_name in _TRUST_FILE_ALIASES:
                        found.add(_TRUST_FILE_ALIASES[sys_name])
    except Exception:
        pass
    return found


def _detect_kb_covered_modules(project_root: str) -> set:
    """Return set of module names mentioned in KB entries."""
    found: set = set()
    try:
        all_entries = ctx.project_engine.search_knowledge("module", top_k=100)
        for entry in all_entries:
            text = (entry.get("title", "") + " " + entry.get("content", "")[:300]).lower()
            for m in re.findall(r'[a-z][a-zA-Z]{8,}', text):
                found.add(m)
    except Exception:
        pass
    return found


def _detect_documented_modules(project_root: str) -> set:
    """Return set of module names mentioned in ARCHITECTURE.md or TUNING_MAP.md."""
    found: set = set()
    for doc in ["doc/ARCHITECTURE.md", "doc/TUNING_MAP.md"]:
        path = os.path.join(project_root, doc)
        if not os.path.isfile(path):
            continue
        try:
            with open(path, encoding="utf-8") as f:
                content = f.read().lower()
            for m in re.findall(r'[a-z][a-zA-Z]{8,}', content):
                found.add(m)
        except Exception:
            pass
    return found
