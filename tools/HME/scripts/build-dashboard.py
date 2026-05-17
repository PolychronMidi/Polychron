#!/usr/bin/env python3
"""Comprehensive HME data visualization dashboard.

Reads every metrics/hme-*.json and metrics/holograph/*.json and produces a
single interactive HTML file with multi-panel plotly.js charts. Multi-layered,
sortable, overlayable -- opens in any browser without dependencies.

Data sources:
  - metrics/holograph/*.json      -> HCI over time, per-category scores
  - metrics/hme-tool-effectiveness.json -> session / lifesaver / tool invocation stats
  - log/hme-hook-latency.jsonl -> per-hook wall time distribution
  - metrics/hme-trajectory.json   -> trend analysis
  - metrics/hme-coupling.json     -> tool pair effectiveness matrix
  - metrics/hme-coherence.jsonl   -> coherence history from old rag_proxy monitor (may be stale after shim deprecation)
  - metrics/hme-hci-forecast.json -> predicted HCI
  - metrics/hme-memetic-drift.json -> rule violation counts
  - metrics/hme-verifier-coverage.json -> fix commit coverage gaps

Output: metrics/hme-dashboard.html

Panels:
  1. HCI over time + per-category overlays (time series)
  2. Current verifier statuses (grouped bar by category)
  3. Tool invocation frequency (horizontal bar)
  4. Hook latency distribution (box plot per hook)
  5. LIFESAVER + meta-observer events over time (scatter)
  6. Warm cache ages (bar)
  7. Tool coupling heatmap (matrix)
  8. Rule violation counts (horizontal bar)

Every panel: sortable legend, hover details, interactive zoom. The HTML
embeds all data as JSON + uses plotly.js via CDN.

Usage:
    python3 tools/HME/scripts/build-dashboard.py
    python3 tools/HME/scripts/build-dashboard.py --open  # xdg-open after write
"""
import glob
import json
import os
import subprocess
import sys
import time

try:
    import numpy as np
    _HAS_NUMPY = True
except ImportError:
    _HAS_NUMPY = False

_PROJECT = os.environ.get("PROJECT_ROOT") or os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "..")
)
METRICS_DIR = os.environ.get("METRICS_DIR") or os.path.join(_PROJECT, "src", "output", "metrics")
_METRICS = os.path.join(METRICS_DIR)
_LOG = os.path.join(_PROJECT, "log")
_OUTPUT = os.path.join(_METRICS, "hme-dashboard.html")


def _safe_load(path: str) -> dict:
    try:
        with open(path) as f:
            return json.load(f)
    except Exception:
        return {}


def _safe_jsonl(path: str) -> list:
    if not os.path.isfile(path):
        return []
    out = []
    try:
        with open(path) as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    out.append(json.loads(line))
                except Exception:
                    continue
    except Exception:
        pass  # silent-ok: diagnostic; failure non-fatal
    return out


def _load_holograph_series() -> dict:
    """Load all holograph snapshots, extract HCI + category scores over time."""
    paths = sorted(glob.glob(os.path.join(_METRICS, "holograph", "holograph-*.json")))
    samples = []
    for p in paths:
        snap = _safe_load(p)
        if not snap:
            continue
        hci_block = snap.get("hci", {})
        captured = snap.get("captured_at", 0)
        if not captured:
            continue
        samples.append({
            "ts": captured,
            "hci": hci_block.get("hci", 0),
            "categories": {
                k: v.get("score", 0) * 100
                for k, v in hci_block.get("categories", {}).items()
            },
        })
    return {"samples": samples}


def _load_current_verifiers() -> dict:
    """Run verify-coherence.py --json to get the current verifier state."""
    script = os.path.join(_PROJECT, "tools", "HME", "scripts", "verify-coherence.py")
    try:
        rc = subprocess.run(
            ["python3", script, "--json"],
            capture_output=True, text=True, timeout=30,
            env={**os.environ, "PROJECT_ROOT": _PROJECT},
        )
        return json.loads(rc.stdout)
    except Exception as e:
        sys.stderr.write(f"verifier fetch failed: {e}\n")
        return {}


def _aggregate_hook_latency() -> dict:
    """Aggregate log/hme-hook-latency.jsonl into per-hook stats."""
    events = _safe_jsonl(os.path.join(_LOG, "hme-hook-latency.jsonl"))
    by_hook = {}
    for e in events:
        hook = e.get("hook", "?")
        dur = float(e.get("duration_ms", 0))
        by_hook.setdefault(hook, []).append(dur)
    result = {}
    for hook, durs in by_hook.items():
        if not durs:
            continue
        durs_sorted = sorted(durs)
        n = len(durs_sorted)
        result[hook] = {
            "count": n,
            "median": durs_sorted[n // 2],
            "p95": durs_sorted[min(n - 1, int(n * 0.95))],
            "max": durs_sorted[-1],
            "min": durs_sorted[0],
            "all": durs,  # for box plot
        }
    return result


def _collect_data() -> dict:
    return {
        "holograph": _load_holograph_series(),
        "verifiers": _load_current_verifiers(),
        "effectiveness": _safe_load(os.path.join(_METRICS, "hme-tool-effectiveness.json")),
        "trajectory": _safe_load(os.path.join(_METRICS, "hme-trajectory.json")),
        "coupling": _safe_load(os.path.join(_METRICS, "hme-coupling.json")),
        "hci_forecast": _safe_load(os.path.join(_METRICS, "hme-hci-forecast.json")),
        "memetic": _safe_load(os.path.join(_METRICS, "hme-memetic-drift.json")),
        "verifier_coverage": _safe_load(os.path.join(_METRICS, "hme-verifier-coverage.json")),
        "hook_latency": _aggregate_hook_latency(),
        "coherence_log": _safe_jsonl(os.path.join(_METRICS, "hme-coherence.jsonl")),
    }


# HTML template with plotly.js via CDN -- extracted to build_dashboard_template.html
_TEMPLATE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "build_dashboard_template.html")


def _load_template() -> str:
    with open(_TEMPLATE_PATH, encoding="utf-8") as f:
        return f.read()




def build() -> int:
    data = _collect_data()
    html = (
        _load_template()
        .replace("__DATA__", json.dumps(data, default=str))
        .replace("__GENERATED__", time.strftime("%Y-%m-%d %H:%M:%S", time.localtime()))
        .replace("__PROJECT__", _PROJECT)
    )
    os.makedirs(os.path.dirname(_OUTPUT), exist_ok=True)
    with open(_OUTPUT, "w") as f:
        f.write(html)
    size = os.path.getsize(_OUTPUT)
    print(f"Dashboard: {_OUTPUT}")
    print(f"  size: {size:,} bytes")
    print(f"  holograph samples: {len(data['holograph'].get('samples', []))}")
    print(f"  verifiers: {(data['verifiers'] or {}).get('verifier_count', 0)}")
    print(f"  hook-latency hooks: {len(data['hook_latency'])}")
    print(f"  coupling nodes: {(data['coupling'] or {}).get('node_count', 0)}")
    return 0


def main(argv: list) -> int:
    rc = build()
    if rc != 0:
        return rc
    if "--open" in argv:
        try:
            subprocess.Popen(["xdg-open", _OUTPUT], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except Exception:
            pass  # silent-ok: diagnostic; failure non-fatal
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
