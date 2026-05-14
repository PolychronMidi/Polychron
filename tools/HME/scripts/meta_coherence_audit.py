#!/usr/bin/env python3
"""Meta-Coherence Audit -- the detector-of-detectors.

Every HME detector/invariant/extractor embeds assumptions about source
structure (regex against a target file, path reference, phrase list, tool
decorator form). When the source shifts (refactor, rename, new pattern,
hook reorg) these assumptions rot SILENTLY -- a dead regex returns null,
a missing path returns "not found", a stale phrase list never triggers.
None of those look like failures. They just become invisible cruft.

This audit scans the diagnostic layer itself and proves each pattern is
still live by running it against its declared target corpus. Zero matches
for an ostensibly-active check = stale. Dead phrases in a detector =
stale. Missing path referenced by an invariant = stale.

What it covers:
  (A) invariants.json pattern_in_file / file_exists / patterns_all_in_file
      -- every path must exist and every pattern must match at least once.
  (B) check-tuning-invariants.js extractConst regexes -- each must produce
      a non-null extraction against its target file.
  (C) health.py doc-sync regex + tool-decorator scanner -- must find the
      expected structural markers.
  (D) evolution_strategies.py stress probe file references -- every hook
      path, every RELOADABLE name must resolve.
  (E) detectors/*.py phrase lists (ADMIT_PHRASES, PERMISSION_ASK_PHRASES,
      BG_KEYWORDS) -- for each phrase, check if it appears in any recent
      transcript (corpus-coverage sampling, not strict liveness).

Exit codes:
    0 -- all patterns live
    1 -- one or more stale patterns detected
    2 -- unexpected error

Usage:
    python3 tools/HME/scripts/meta_coherence_audit.py
    python3 tools/HME/scripts/meta_coherence_audit.py --json  # machine-readable
    python3 tools/HME/scripts/meta_coherence_audit.py --write-metrics
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path


def _require_project_root() -> Path:
    root = os.environ.get("PROJECT_ROOT")
    if not root:
        # Walk up from this script looking for CLAUDE.md + .env sentinels.
        here = Path(__file__).resolve()
        for parent in [here.parent, *here.parents]:
            if (parent / "CLAUDE.md").exists() and (parent / ".env").exists():
                return parent
        raise RuntimeError("Cannot resolve PROJECT_ROOT. Set env or invoke with project-root sentinels.")
    return Path(root)



# (A) invariants.json


def audit_invariants_json(root: Path) -> list[dict]:
    """Check every invariant's path exists and pattern still matches."""
    findings: list[dict] = []
    inv_path = root / "tools" / "HME" / "config" / "invariants.json"
    if not inv_path.exists():
        return [{"source": "invariants.json", "status": "MISSING", "detail": str(inv_path)}]
    data = json.loads(inv_path.read_text())
    invariants = data.get("invariants", []) if isinstance(data, dict) else data
    for inv in invariants:
        inv_id = inv.get("id", "<unnamed>")
        inv_type = inv.get("type", "")
        path = inv.get("path", "")
        pattern = inv.get("pattern", "")

        # Single-path types
        if inv_type in ("pattern_in_file", "patterns_all_in_file", "pattern_count_gte",
                        "pattern_in_file_not", "file_exists", "json_valid", "symlink_valid"):
            # ~ expansion: invariants may reference dotfiles under $HOME
            # (symlink-mcp/-skills target ~/.claude/...). Resolve relative to
            # the real home, not the project root, for those.
            if path and path.startswith("~"):
                full = Path(path).expanduser()
            else:
                full = root / path if path else None
            if full and not full.exists():
                findings.append({
                    "source": "invariants.json",
                    "id": inv_id,
                    "type": inv_type,
                    "status": "STALE",
                    "detail": f"path does not exist: {path}",
                })
                continue
            if inv_type in ("pattern_in_file", "pattern_count_gte") and pattern and full and full.is_file():
                try:
                    text = full.read_text(errors="ignore")
                    if not re.search(pattern, text):
                        findings.append({
                            "source": "invariants.json",
                            "id": inv_id,
                            "type": inv_type,
                            "status": "STALE",
                            "detail": f"pattern never matches in {path}: {pattern[:80]}",
                        })
                except Exception as e:
                    findings.append({
                        "source": "invariants.json",
                        "id": inv_id,
                        "type": inv_type,
                        "status": "ERROR",
                        "detail": f"read failed: {type(e).__name__}: {e}",
                    })
            if inv_type == "patterns_all_in_file" and full and full.is_file():
                patterns = inv.get("patterns", [])
                try:
                    text = full.read_text(errors="ignore")
                    for p in patterns:
                        if not re.search(p, text):
                            findings.append({
                                "source": "invariants.json",
                                "id": inv_id,
                                "type": inv_type,
                                "status": "STALE",
                                "detail": f"pattern never matches in {path}: {p[:80]}",
                            })
                except Exception as e:
                    findings.append({
                        "source": "invariants.json",
                        "id": inv_id,
                        "type": inv_type,
                        "status": "ERROR",
                        "detail": f"read failed: {type(e).__name__}: {e}",
                    })
    return findings



# (B) check-tuning-invariants.js extractors


def audit_tuning_extractors(root: Path) -> list[dict]:
    """Run the tuning-invariants validator and check every named constant
    was extracted (non-null)."""
    findings: list[dict] = []
    validator = root / "scripts" / "pipeline" / "validators" / "check-tuning-invariants.js"
    if not validator.exists():
        return [{"source": "check-tuning-invariants.js", "status": "MISSING",
                 "detail": str(validator)}]
    # Run in dry-extract mode: invoke the existing script and parse stderr/stdout
    # for any "WARNING - could not extract" lines. Rather than adding a new flag,
    # we invoke the production file so extractor drift surfaces here too.
    import subprocess
    try:
        rc = subprocess.run(
            ["node", str(validator)], capture_output=True, text=True,
            timeout=30, cwd=str(root), env={**os.environ, "PROJECT_ROOT": str(root)},  # env-ok
        )
    except Exception as e:
        return [{"source": "check-tuning-invariants.js", "status": "ERROR",
                 "detail": f"invoke failed: {type(e).__name__}: {e}"}]
    blob = (rc.stdout or "") + "\n" + (rc.stderr or "")
    for m in re.finditer(r"could not extract (\d+) constant\(s\):\s*([^\n]+)", blob):
        for name in m.group(2).split(","):
            findings.append({
                "source": "check-tuning-invariants.js",
                "id": name.strip(),
                "type": "extractConst",
                "status": "STALE",
                "detail": "extractor regex returned null -- target pattern likely drifted",
            })
    return findings



# (C) health.py doc-sync


def audit_doc_sync(root: Path) -> list[dict]:
    """Exercise the doc-sync check against doc/HME.md. Failures here mean
    the agent-facing tool-count claim in the doc has drifted from code."""
    findings: list[dict] = []
    import subprocess
    py = sys.executable or "python3"
    # Use the same `doc_sync_check` path the selftest exercises, via a one-liner.
    cmd = [py, "-c", (
        "import os, sys;"
        "sys.path.insert(0, os.path.join(os.environ['PROJECT_ROOT'], 'tools', 'HME', 'mcp'));"
        "os.environ.setdefault('HF_HUB_OFFLINE', '1');"
        "os.environ.setdefault('TRANSFORMERS_OFFLINE', '1');"
        "from server.tools_analysis.health import doc_sync_check;"
        "print(doc_sync_check('doc/HME.md'))"
    )]
    try:
        rc = subprocess.run(cmd, capture_output=True, text=True, timeout=30,
                            cwd=str(root),
                            env={**os.environ, "PROJECT_ROOT": str(root)})  # env-ok
        out = rc.stdout or ""
        if "OUT OF SYNC" in out or "STALE" in out or "MISSING" in out:
            findings.append({
                "source": "health.py doc_sync_check",
                "id": "doc/HME.md",
                "type": "doc_sync",
                "status": "STALE",
                "detail": out.strip()[:400],
            })
    except Exception as e:
        findings.append({
            "source": "health.py doc_sync_check",
            "status": "ERROR",
            "detail": f"invoke failed: {type(e).__name__}: {e}",
        })
    return findings



# (D) evolution_strategies.py stress probe file refs


def audit_stress_probe_refs(root: Path) -> list[dict]:
    """Verify every hook path referenced by the stress probe resolves, and
    every RELOADABLE module name exists as an actual file. The stress probe
    was fixed once already this session; keep it honest going forward."""
    findings: list[dict] = []
    # Critical hooks the probe expects
    hooks_dir = root / "tools" / "HME" / "hooks"
    sub_dirs = ["", "lifecycle", "pretooluse", "posttooluse", "helpers"]
    critical_hooks = [
        "sessionstart.sh", "userpromptsubmit.sh",
        "log-tool-call.sh",
        "pretooluse_edit.sh", "pretooluse_bash.sh",
        "posttooluse_read_kb.sh", "postcompact.sh", "_safety.sh",
    ]
    for hook in critical_hooks:
        found = False
        for sub in sub_dirs:
            cand = hooks_dir / sub / hook if sub else hooks_dir / hook
            if cand.is_file():
                found = True
                break
        if not found:
            findings.append({
                "source": "evolution_strategies stress probe",
                "id": hook,
                "type": "critical_hook",
                "status": "MISSING",
                "detail": f"none of {sub_dirs} under tools/HME/hooks/ has {hook}",
            })
    # RELOADABLE modules
    try:
        src = (root / "tools" / "HME" / "mcp" / "server" / "tools_analysis"
               / "evolution" / "evolution_selftest.py").read_text()
        for listname in ("RELOADABLE", "TOP_LEVEL_RELOADABLE", "ROOT_RELOADABLE"):
            m = re.search(rf'{listname}\s*=\s*\[([^\]]*)\]', src)
            if not m:
                continue
            items = re.findall(r'["\']([a-zA-Z_][a-zA-Z0-9_]*)["\']', m.group(1))
            if listname == "RELOADABLE":
                search_dirs = [
                    root / "tools" / "HME" / "mcp" / "server" / "tools_analysis",
                    root / "tools" / "HME" / "mcp" / "server" / "tools_analysis" / "synthesis",
                    root / "tools" / "HME" / "mcp" / "server" / "tools_analysis" / "evolution",
                    root / "tools" / "HME" / "mcp" / "server" / "tools_analysis" / "coupling",
                ]
            elif listname == "TOP_LEVEL_RELOADABLE":
                search_dirs = [root / "tools" / "HME" / "mcp" / "server"]
            else:
                search_dirs = [root / "tools" / "HME" / "mcp"]
            for name in items:
                if not any((d / f"{name}.py").is_file() for d in search_dirs):
                    findings.append({
                        "source": "evolution_selftest",
                        "id": f"{listname}.{name}",
                        "type": "reloadable",
                        "status": "MISSING",
                        "detail": f"{name}.py not found in {[str(d.name) for d in search_dirs]}",
                    })
    except Exception as e:
        findings.append({
            "source": "evolution_selftest RELOADABLE",
            "status": "ERROR",
            "detail": f"{type(e).__name__}: {e}",
        })
    return findings



# (E) detectors/*.py phrase-list coverage



# Re-exports -- secondary audits extracted to sibling.
from meta_coherence_audits import (  # noqa: F401, E402
    audit_detector_phrases, audit_hme_log_errors,
    audit_hook_sources, audit_module_imports,
)

def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--json", action="store_true", help="machine-readable output")
    parser.add_argument("--write-metrics", action="store_true",
                        help="also write metrics/meta-coherence.json")
    args = parser.parse_args()

    try:
        root = _require_project_root()
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 2

    all_findings: list[dict] = []
    sections = [
        ("invariants.json", audit_invariants_json),
        ("check-tuning-invariants.js", audit_tuning_extractors),
        ("doc_sync_check", audit_doc_sync),
        ("stress probe refs", audit_stress_probe_refs),
        ("detector phrase coverage", audit_detector_phrases),
        ("hme.log ERROR freshness", audit_hme_log_errors),
        ("hook source-path validity", audit_hook_sources),
        ("module-load smoke test", audit_module_imports),
    ]
    for label, fn in sections:
        try:
            all_findings.extend(fn(root))
        except Exception as e:
            all_findings.append({
                "source": label,
                "status": "ERROR",
                "detail": f"audit crashed: {type(e).__name__}: {e}",
            })

    # Categorize
    stale = [f for f in all_findings if f.get("status") in ("STALE", "MISSING")]
    errors = [f for f in all_findings if f.get("status") == "ERROR"]
    info = [f for f in all_findings if f.get("status") == "INFO"]

    if args.write_metrics:
        out_path = root / "metrics" / "meta-coherence.json"
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(json.dumps({
            "total_findings": len(all_findings),
            "stale": len(stale),
            "errors": len(errors),
            "info": len(info),
            "findings": all_findings,
        }, indent=2))

    if args.json:
        print(json.dumps(all_findings, indent=2))
    else:
        print(f"# Meta-Coherence Audit")
        print(f"  Stale/missing: {len(stale)}")
        print(f"  Errors:        {len(errors)}")
        print(f"  Info/coverage: {len(info)}")
        for f in stale:
            print(f"  STALE [{f.get('source')}] {f.get('id', '?')}: {f.get('detail', '')}")
        for f in errors:
            print(f"  ERROR [{f.get('source')}] {f.get('detail', '')}")
        for f in info[:10]:
            print(f"  INFO  [{f.get('source')}] {f.get('id', '?')}: {f.get('detail', '')}")
        if len(info) > 10:
            print(f"  ... ({len(info) - 10} more INFO entries suppressed)")

    return 1 if (stale or errors) else 0


if __name__ == "__main__":
    sys.exit(main())
