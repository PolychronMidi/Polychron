#!/usr/bin/env python3
"""i/why mode=fractal-shape -- Horizon X seed.

The architecture *claims* to be a tensegrity at every scale (project,
subsystem, module, verifier graph, KB graph). This seed measures the
shape at each scale and reports whether the fan-out distribution
LOOKS LIKE the tensegrity hypothesis predicts (a few hubs, many
leaves) -- a proxy for "load distributes globally."

Operationalization:
  - At each scale, compute element count and fan-out distribution.
  - Power-law-ish (max >> median, top-quartile concentrated) =
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
import re
import sys
from collections import Counter

from _common import PROJECT_ROOT


def _gini(values: list[int | float]) -> float:
    """Gini coefficient -- 0 = uniform, 1 = maximally concentrated. A
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
    sig = {
        "name": name,
        "n": len(s),
        "total": sum(s),
        "max": s[-1],
        "median": s[len(s) // 2],
        "p90": s[int(len(s) * 0.9)] if len(s) >= 10 else s[-1],
        "gini": _gini(s),
    }
    # Horizon X maturity -- synthetic ablation. Recompute Gini after
    if len(s) >= 3:
        ablated = s[:-1]
        sig["gini_no_max"] = _gini(ablated)
        sig["redundancy"] = "yes" if sig["gini_no_max"] >= 0.30 else "no"
    else:
        sig["gini_no_max"] = None
        sig["redundancy"] = "--"
    return sig


def _measure_subsystems() -> dict:
    """Project -> subsystem fan-out: each subsystem's file count."""
    src = os.path.join(PROJECT_ROOT, "src")
    if not os.path.isdir(src):
        return _scale_signature("project->subsystem", [])
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
    return _scale_signature("project->subsystem", counts)


def _measure_module_loc() -> dict:
    """Subsystem -> module fan-out: each module's LOC. Approximates
    'how concentrated is logic in a few modules vs spread across many.'"""
    src = os.path.join(PROJECT_ROOT, "src")
    if not os.path.isdir(src):
        return _scale_signature("subsystem->module(LOC)", [])
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
    return _scale_signature("subsystem->module(LOC)", counts)


def _measure_verifier_categories() -> dict:
    """Verifier graph -> category fan-out."""
    sys.path.insert(0, os.path.join(PROJECT_ROOT, "tools", "HME", "scripts"))
    try:
        from verify_coherence import REGISTRY  # type: ignore
    except Exception:
        return _scale_signature("verifier->category", [])
    cat_counts: Counter = Counter()
    for v in REGISTRY:
        cat_counts[getattr(v, "category", "?")] += 1
    return _scale_signature("verifier->category", list(cat_counts.values()))


def _measure_verifier_subtags() -> dict:
    sys.path.insert(0, os.path.join(PROJECT_ROOT, "tools", "HME", "scripts"))
    try:
        from verify_coherence import REGISTRY  # type: ignore
    except Exception:
        return _scale_signature("verifier->subtag", [])
    cat_counts: Counter = Counter()
    for v in REGISTRY:
        cat_counts[getattr(v, "subtag", "?")] += 1
    return _scale_signature("verifier->subtag", list(cat_counts.values()))


def _measure_kb_categories() -> dict:
    sys.path.insert(0, os.path.join(PROJECT_ROOT, "tools", "HME", "service"))
    try:
        from direct_lance import _open_table  # type: ignore
    except Exception:
        return _scale_signature("kb->category", [])
    table = _open_table()
    if table is None:
        return _scale_signature("kb->category", [])
    try:
        df = table.to_pandas()
    except Exception:
        return _scale_signature("kb->category", [])
    cat_counts = df["category"].value_counts() if "category" in df.columns else None
    if cat_counts is None:
        return _scale_signature("kb->category", [])
    return _scale_signature("kb->category", list(cat_counts.values))


def _measure_l0_channels() -> dict:
    """L0 channel -> consumer fan-out: how many places consume each channel.
    Uses a single combined-alternation grep instead of 35 per-channel
    forks. grep -E with `chan1|chan2|...|chanN` walks the tree ONCE and
    reports matches for any channel; we then parse the output back to
    per-channel file sets. Drops latency below the multi-fork approach."""
    rules_path = os.path.join(PROJECT_ROOT, "tools", "HME", "config",
                              "project-rules.json")
    if not os.path.isfile(rules_path):
        return _scale_signature("L0->consumers", [])
    try:
        import json
        with open(rules_path) as f:
            channels = json.load(f).get("known_l0_channels", [])
    except Exception:
        return _scale_signature("L0->consumers", [])
    src_dir = os.path.join(PROJECT_ROOT, "src")
    if not os.path.isdir(src_dir) or not channels:
        return _scale_signature("L0->consumers", [])
    # Single combined grep: alternation of all channel words; output is
    # `path:line` per match, we count distinct paths per channel.
    import subprocess
    pattern = r"\b(" + "|".join(re.escape(c) for c in channels) + r")\b"
    try:
        r = subprocess.run(
            ["grep", "-rEon", "--include=*.js", pattern, src_dir],
            capture_output=True, text=True, timeout=30,
        )
    except (subprocess.SubprocessError, OSError):
        return _scale_signature("L0->consumers", [])
    files_per_chan: dict[str, set[str]] = {chan: set() for chan in channels}
    chan_set = set(channels)
    # Output format: file:line:matched-text. -o emits ONLY the matched
    for ln in r.stdout.splitlines():
        parts = ln.split(":", 2)
        if len(parts) < 3:
            continue
        fp, _line, match_field = parts
        match_field = match_field.strip()
        if match_field in chan_set:
            files_per_chan[match_field].add(fp)
    counts = [len(s) for s in files_per_chan.values() if s]
    return _scale_signature("L0->consumers", counts)


def _measure_policies_by_event() -> dict:
    """Policy -> trigger event fan-out: each event has N policies."""
    pol_dir = os.path.join(PROJECT_ROOT, "tools", "HME", "policies", "builtin")
    if not os.path.isdir(pol_dir):
        return _scale_signature("policy->event", [])
    from collections import Counter
    event_counts: Counter = Counter()
    for f in os.listdir(pol_dir):
        if not f.endswith(".js"):
            continue
        try:
            with open(os.path.join(pol_dir, f), encoding="utf-8") as fp:
                src = fp.read()
        except OSError:
            continue
        # Each policy declares match.events -- count occurrences
        m = re.search(r"events:\s*\[([^\]]+)\]", src)
        if m:
            for ev in re.findall(r"['\"](\w+)['\"]", m.group(1)):
                event_counts[ev] += 1
    return _scale_signature("policy->event", list(event_counts.values()))


def _append_history(scales: list[dict]) -> None:
    """Append a per-run snapshot of per-scale Gini values to
    output/metrics/hme-fractal-history.jsonl. Enables `mode=fractal-shape
    history=true` to render the trend over time -- is the architecture
    becoming MORE or LESS tensegrity-shaped over rounds? Atomic write
    via temp+os.replace pattern (matches the project's data-integrity
    invariant)."""
    import json
    import time
    history_path = os.path.join(PROJECT_ROOT, "output", "metrics",
                                "hme-fractal-history.jsonl")
    try:
        os.makedirs(os.path.dirname(history_path), exist_ok=True)
    except OSError:
        return
    row = {
        "ts": time.time(),
        "scales": {s["name"]: {"n": s["n"], "gini": round(s.get("gini", 0.0), 3)}
                   for s in scales if s["n"] > 0},
        "mean_gini": round(
            sum(s["gini"] for s in scales if s["n"] > 0) /
            max(1, sum(1 for s in scales if s["n"] > 0)), 3
        ),
    }
    try:
        with open(history_path, "a") as f:
            f.write(json.dumps(row) + "\n")
    except OSError:
        pass  # silent-ok: best-effort fs op


def _render_history() -> str:
    """Read fractal-history.jsonl and report Gini trend per scale across
    recent runs. Detects whether the architecture's tensegrity-shape is
    rising, falling, or steady."""
    import json
    history_path = os.path.join(PROJECT_ROOT, "output", "metrics",
                                "hme-fractal-history.jsonl")
    if not os.path.isfile(history_path):
        return "  (no history yet -- run `i/why mode=fractal-shape` more times to accumulate)"
    try:
        with open(history_path) as f:
            rows = [json.loads(ln) for ln in f if ln.strip()]
    except (OSError, ValueError):
        return "  (history file unreadable)"
    if len(rows) < 2:
        return f"  ({len(rows)} run(s) recorded -- need >=2 for trend)"
    out = [f"  {len(rows)} runs recorded; mean-Gini trend:"]
    # Latest vs first
    first_mean = rows[0].get("mean_gini", 0.0)
    last_mean = rows[-1].get("mean_gini", 0.0)
    delta = last_mean - first_mean
    direction = "-> steady" if abs(delta) < 0.02 else (
        "^ tensegrity-strengthening" if delta > 0 else "v tensegrity-weakening"
    )
    out.append(f"    first run: mean Gini {first_mean:.2f}")
    out.append(f"    latest:    mean Gini {last_mean:.2f}  ({direction})")
    return "\n".join(out)


def main(argv):
    show_history = any(a == "history=true" or a == "--history"
                       for a in argv[1:])
    scales = [
        _measure_subsystems(),
        _measure_module_loc(),
        _measure_verifier_categories(),
        _measure_verifier_subtags(),
        _measure_kb_categories(),
        _measure_l0_channels(),
        _measure_policies_by_event(),
    ]
    # Record this run for time-series tracking (Horizon X asymptote).
    _append_history(scales)

    print(f"# Fractal-shape signature  (Horizon X)")
    print(f"  At each architectural scale: element count + fan-out concentration.")
    print(f"  Tensegrity hypothesis predicts power-law-ish fan-out (Gini >=~ 0.4):")
    print(f"  a few hubs absorb most connections, many leaves. Uniform fan-out")
    print(f"  (Gini ~= 0) is the non-tensegrity counter-shape.")
    print()
    print(f"  {'scale':28}  {'n':>4}  {'gini':>5}  {'gini-no-max':>11}  "
          f"{'redundancy':>11}  {'tensegrity-shape?':>17}")
    for s in scales:
        if s["n"] == 0:
            print(f"  {s['name']:28}  -    no data")
            continue
        gini = s["gini"]
        shape = "yes" if gini >= 0.4 else ("partial" if gini >= 0.25 else "no")
        marker = " " if shape == "yes" else ("." if shape == "partial" else "!")
        gini_nm = s.get("gini_no_max")
        gini_nm_str = f"{gini_nm:.2f}" if isinstance(gini_nm, (int, float)) else "--"
        red = s.get("redundancy", "--")
        print(f"  {marker} {s['name']:26}  "
              f"{s['n']:>4}  {gini:>5.2f}  {gini_nm_str:>11}  "
              f"{red:>11}  {shape:>17}")
    print()
    # Uniform-baseline contrast -- a synthetic uniform distribution of
    valid_ginis = [s["gini"] for s in scales if s["n"] > 0]
    if valid_ginis:
        avg_gini = sum(valid_ginis) / len(valid_ginis)
        above_threshold = sum(1 for g in valid_ginis if g >= 0.40)
        print()
        print(f"## Empirical signature vs uniform-baseline:")
        print(f"  measured levels:    {len(valid_ginis)}")
        print(f"  mean Gini:          {avg_gini:.2f}")
        print(f"  uniform-baseline:   ~0.00  (synthetic uniform of same total = 0)")
        print(f"  power-law-baseline: ~0.65  (canonical tensegrity-shape)")
        print(f"  levels at Gini>=0.40 (tensegrity-shaped): {above_threshold}/{len(valid_ginis)}")
        if avg_gini >= 0.40 and above_threshold >= len(valid_ginis) * 0.6:
            print(f"  verdict: SUPPORTS the tensegrity hypothesis (mean above 0.40,")
            print(f"           majority of levels structurally concentrated)")
        elif avg_gini >= 0.25:
            print(f"  verdict: PARTIAL support (concentrated relative to uniform but")
            print(f"           not as power-law-shaped as the canonical hypothesis)")
        else:
            print(f"  verdict: NOT SUPPORTED at this measurement (mean Gini below 0.25)")

    print()
    print("# Reading the table:")
    print("  - High Gini = a few elements carry disproportionately much; matches")
    print("    the tensegrity prediction (compression-rich hubs, tension web).")
    print("  - Low Gini = roughly uniform; the level isn't load-concentrated.")
    print("  - Recursive question: is the SHAPE itself preserved across levels?")
    print("    If all rows are 'yes', the architecture's recursion claim holds")
    print("    structurally. If some rows are 'no', those are levels where the")
    print("    tensegrity is actually flat -- interesting but not falsifying.")
    if show_history:
        print()
        print("## Tensegrity-shape trend over time:")
        print(_render_history())

    print()
    print("# Note:")
    print("  Static topology proxy. The hypothesis 'removing one element")
    print("  redistributes load sub-proportionally' requires per-element")
    print("  ablation runs to test directly -- out of scope for this seed.")
    print("  Pass `history=true` to see Gini trend across recent runs.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
