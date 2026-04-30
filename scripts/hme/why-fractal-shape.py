#!/usr/bin/env python3
"""i/why mode=fractal-shape — Horizon X seed.

The architecture *claims* to be a tensegrity at every scale (project,
subsystem, module, verifier graph, KB graph). This seed measures the
shape at each scale and reports whether the fan-out distribution
LOOKS LIKE the tensegrity hypothesis predicts (a few hubs, many
leaves) — a proxy for "load distributes globally."

Operationalization:
  - At each scale, compute element count and fan-out distribution.
  - Power-law-ish (max ≫ median, top-quartile concentrated) =
    tensegrity-shaped. Uniform fan-out = NOT tensegrity-shaped.
  - Report each scale's signature side-by-side.

Honest limitation: this is a topological proxy, not a load-distribution
test. The tensegrity hypothesis is "removing one element redistributes
load sub-proportionally"; truly testing that requires per-element
ablation runs. Out of scope. This seed measures the static shape, which
the hypothesis should produce as a side-effect.
"""
from __future__ import annotations
import os
import sys
from collections import Counter

from _common import PROJECT_ROOT


def _gini(values: list[int | float]) -> float:
    """Gini coefficient — 0 = uniform, 1 = maximally concentrated. A
    tensegrity-shaped distribution has Gini > ~0.4."""
    if not values:
        return 0.0
    s = sorted(float(v) for v in values)
    n = len(s)
    total = sum(s) or 1.0
    cumulative = 0.0
    weighted = 0.0
    for i, v in enumerate(s, start=1):
        cumulative += v
        weighted += i * v
    return (2 * weighted) / (n * total) - (n + 1) / n


def _scale_signature(name: str, fan_outs: list[int]) -> dict:
    if not fan_outs:
        return {"name": name, "n": 0, "max": 0, "median": 0, "gini": 0}
    s = sorted(fan_outs)
    return {
        "name": name,
        "n": len(s),
        "total": sum(s),
        "max": s[-1],
        "median": s[len(s) // 2],
        "p90": s[int(len(s) * 0.9)] if len(s) >= 10 else s[-1],
        "gini": _gini(s),
    }


def _measure_subsystems() -> dict:
    """Project → subsystem fan-out: each subsystem's file count."""
    src = os.path.join(PROJECT_ROOT, "src")
    if not os.path.isdir(src):
        return _scale_signature("project→subsystem", [])
    counts = []
    for d in os.listdir(src):
        sub = os.path.join(src, d)
        if not os.path.isdir(sub):
            continue
        n = 0
        for r, _d, files in os.walk(sub):
            n += sum(1 for f in files if f.endswith(".js"))
        if n > 0:
            counts.append(n)
    return _scale_signature("project→subsystem", counts)


def _measure_module_loc() -> dict:
    """Subsystem → module fan-out: each module's LOC. Approximates
    'how concentrated is logic in a few modules vs spread across many.'"""
    src = os.path.join(PROJECT_ROOT, "src")
    if not os.path.isdir(src):
        return _scale_signature("subsystem→module(LOC)", [])
    counts = []
    for r, _d, files in os.walk(src):
        for f in files:
            if not f.endswith(".js"):
                continue
            try:
                with open(os.path.join(r, f), encoding="utf-8") as fp:
                    counts.append(sum(1 for _ in fp))
            except OSError:
                continue
    return _scale_signature("subsystem→module(LOC)", counts)


def _measure_verifier_categories() -> dict:
    """Verifier graph → category fan-out."""
    sys.path.insert(0, os.path.join(PROJECT_ROOT, "tools", "HME", "scripts"))
    try:
        from verify_coherence import REGISTRY  # type: ignore
    except Exception:
        return _scale_signature("verifier→category", [])
    cat_counts: Counter = Counter()
    for v in REGISTRY:
        cat_counts[getattr(v, "category", "?")] += 1
    return _scale_signature("verifier→category", list(cat_counts.values()))


def _measure_verifier_subtags() -> dict:
    sys.path.insert(0, os.path.join(PROJECT_ROOT, "tools", "HME", "scripts"))
    try:
        from verify_coherence import REGISTRY  # type: ignore
    except Exception:
        return _scale_signature("verifier→subtag", [])
    cat_counts: Counter = Counter()
    for v in REGISTRY:
        cat_counts[getattr(v, "subtag", "?")] += 1
    return _scale_signature("verifier→subtag", list(cat_counts.values()))


def _measure_kb_categories() -> dict:
    sys.path.insert(0, os.path.join(PROJECT_ROOT, "tools", "HME", "service"))
    try:
        from direct_lance import _open_table  # type: ignore
    except Exception:
        return _scale_signature("kb→category", [])
    table = _open_table()
    if table is None:
        return _scale_signature("kb→category", [])
    try:
        df = table.to_pandas()
    except Exception:
        return _scale_signature("kb→category", [])
    cat_counts = df["category"].value_counts() if "category" in df.columns else None
    if cat_counts is None:
        return _scale_signature("kb→category", [])
    return _scale_signature("kb→category", list(cat_counts.values))


def main(argv):
    scales = [
        _measure_subsystems(),
        _measure_module_loc(),
        _measure_verifier_categories(),
        _measure_verifier_subtags(),
        _measure_kb_categories(),
    ]

    print(f"# Fractal-shape signature  (Horizon X)")
    print(f"  At each architectural scale: element count + fan-out concentration.")
    print(f"  Tensegrity hypothesis predicts power-law-ish fan-out (Gini ≳ 0.4):")
    print(f"  a few hubs absorb most connections, many leaves. Uniform fan-out")
    print(f"  (Gini ≈ 0) is the non-tensegrity counter-shape.")
    print()
    print(f"  {'scale':28}  {'n':>4}  {'total':>6}  {'max':>5}  "
          f"{'median':>7}  {'p90':>5}  {'gini':>5}  {'tensegrity-shape?':>17}")
    for s in scales:
        if s["n"] == 0:
            print(f"  {s['name']:28}  ─    no data")
            continue
        gini = s["gini"]
        shape = "yes" if gini >= 0.4 else ("partial" if gini >= 0.25 else "no")
        marker = " " if shape == "yes" else ("·" if shape == "partial" else "!")
        print(f"  {marker} {s['name']:26}  "
              f"{s['n']:>4}  {s.get('total', '─'):>6}  "
              f"{s['max']:>5}  {s['median']:>7}  {s.get('p90', '─'):>5}  "
              f"{gini:>5.2f}  {shape:>17}")
    print()
    print("# Reading the table:")
    print("  - High Gini = a few elements carry disproportionately much; matches")
    print("    the tensegrity prediction (compression-rich hubs, tension web).")
    print("  - Low Gini = roughly uniform; the level isn't load-concentrated.")
    print("  - Recursive question: is the SHAPE itself preserved across levels?")
    print("    If all rows are 'yes', the architecture's recursion claim holds")
    print("    structurally. If some rows are 'no', those are levels where the")
    print("    tensegrity is actually flat — interesting but not falsifying.")
    print()
    print("# Note:")
    print("  Static topology proxy. The hypothesis 'removing one element")
    print("  redistributes load sub-proportionally' requires per-element")
    print("  ablation runs to test directly — out of scope for this seed.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
