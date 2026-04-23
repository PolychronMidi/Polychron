#!/usr/bin/env python3
"""Verify HME coherence-registry — validate the 'no layer is optional' promise.

Reads tools/HME/config/coherence-registry.json and checks each subsystem's
declared artifacts exist (and are fresh where freshness is specified).
Reports per-subsystem health. Writes output/metrics/hme-coherence-health.json
so consumers (status tool, session banner) can surface coherence gaps.

This is distinct from verify-coherence.py (the HCI verifier substrate) —
THAT computes the Coherence Index from runtime signals. THIS confirms each
declared subsystem has backing artifacts, turning the registry into a
testable contract.

Exit code: 0 if all subsystems pass, 1 if any subsystem has a hard failure.
"""
from __future__ import annotations
import json
import os
import sys
import time
from pathlib import Path

PROJECT_ROOT = Path(os.environ.get("PROJECT_ROOT", Path(__file__).resolve().parent.parent.parent.parent))
REGISTRY = PROJECT_ROOT / "tools" / "HME" / "config" / "coherence-registry.json"
OUTPUT = PROJECT_ROOT / "output" / "metrics" / "hme-coherence-health.json"


def _check_artifact(art: dict, ceilings: dict) -> tuple[bool, str]:
    path = PROJECT_ROOT / art["path"]
    allow_empty = art.get("allow_empty", False)
    is_dir = art.get("is_dir", False)
    if not path.exists():
        return False, f"missing: {art['path']}"
    if is_dir:
        if not path.is_dir():
            return False, f"expected dir, found file: {art['path']}"
        return True, "ok"
    if not path.is_file():
        return False, f"not a file: {art['path']}"
    if not allow_empty and path.stat().st_size == 0:
        return False, f"empty: {art['path']}"
    freshness_key = art.get("freshness")
    if freshness_key:
        ceiling = ceilings.get(f"{freshness_key}_seconds", ceilings.get("default_seconds", 86400))
        age = time.time() - path.stat().st_mtime
        if age > ceiling:
            return False, f"stale: {art['path']} ({int(age)}s > {ceiling}s)"
    return True, "ok"


def main() -> int:
    if not REGISTRY.is_file():
        print(f"coherence-registry.json missing at {REGISTRY}", file=sys.stderr)
        return 2
    with open(REGISTRY) as f:
        reg = json.load(f)
    ceilings = reg.get("freshness_ceilings", {})
    results = []
    healthy_ids: set[str] = set()
    for sub in reg.get("subsystems", []):
        sub_ok = True
        issues: list[str] = []
        for art in sub.get("artifacts", []):
            ok, msg = _check_artifact(art, ceilings)
            if not ok:
                sub_ok = False
                issues.append(msg)
        for dep in sub.get("depends_on", []):
            if dep not in healthy_ids:
                issues.append(f"dependency_unresolved:{dep}")
        if sub_ok:
            healthy_ids.add(sub["id"])
        results.append({
            "id": sub["id"],
            "description": sub.get("description", ""),
            "healthy": sub_ok,
            "issues": issues,
            "public_surfaces": sub.get("public_surfaces", []),
        })
    all_healthy = all(r["healthy"] for r in results)
    health = {
        "generated_at": int(time.time()),
        "all_healthy": all_healthy,
        "healthy_count": sum(1 for r in results if r["healthy"]),
        "total": len(results),
        "subsystems": results,
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT, "w") as f:
        json.dump(health, f, indent=2)
    print(f"HME coherence-registry: {health['healthy_count']}/{health['total']} subsystems healthy")
    for r in results:
        marker = "OK " if r["healthy"] else "!! "
        issues = f" — {'; '.join(r['issues'][:3])}" if r["issues"] else ""
        print(f"  {marker}{r['id']}{issues}")
    return 0 if all_healthy else 1


if __name__ == "__main__":
    sys.exit(main())
