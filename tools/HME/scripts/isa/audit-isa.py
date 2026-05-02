#!/usr/bin/env python3
"""Audit one or more ISA documents.

Reports per-ISA:
  - tier-completeness gate (missing required sections)
  - section-order violations (canonical order broken)
  - unverified ISCs (marked [x] without an entry in Verification)
  - count of total / done / anti / antecedent / tombstone criteria
  - frontmatter sanity (slug, phase, tier present)

Optional: --diff <old> <new> runs the ID-stability audit, refusing
silent renumbers / Anti-flag flips between two snapshots of the same
ISA.

Usage:
    python3 tools/HME/scripts/isa/audit-isa.py <path> [<path> ...]
    python3 tools/HME/scripts/isa/audit-isa.py --diff old/ISA.md new/ISA.md
    python3 tools/HME/scripts/isa/audit-isa.py --json <path>
    python3 tools/HME/scripts/isa/audit-isa.py --strict <path>     # exit 1 on any
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from isa_lib import (  # noqa: E402
    parse_isa, check_completeness, section_order_violations,
    unverified_iscs, audit_id_stability, list_isc, deferred_iscs,
    deferred_resolution_violations,
)


def _audit_one(path: Path) -> dict:
    d = parse_isa(path)
    tier = d.frontmatter.get("tier", "")
    deferred = deferred_iscs(d)
    findings: dict = {
        "path": str(path),
        "tier": tier,
        "phase": d.frontmatter.get("phase", ""),
        "iscs_total": len(d.iscs),
        "iscs_done": sum(1 for i in d.iscs if i.status == "[x]"),
        "iscs_anti": sum(1 for i in d.iscs if i.is_anti),
        "iscs_antecedent": sum(1 for i in d.iscs if i.is_antecedent),
        "iscs_tombstone": sum(1 for i in d.iscs if i.is_tombstone),
        "iscs_deferred": len(deferred),
        "missing_sections": [],
        "order_violations": section_order_violations(d),
        "unverified": [i.id for i in unverified_iscs(d)],
        "deferred": [(i.id, i.deferred_task) for i in deferred],
    }
    if tier:
        try:
            findings["missing_sections"] = check_completeness(d, tier)
        except ValueError as e:
            findings["error"] = str(e)
    if not tier:
        findings["error"] = "frontmatter missing 'tier' — completeness gate cannot evaluate"
    return findings


def main(argv: list) -> int:
    as_json = False
    strict = False
    diff_mode = False
    paths: list[Path] = []
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == "--json":
            as_json = True
        elif a == "--strict":
            strict = True
        elif a == "--diff":
            diff_mode = True
        elif a in ("-h", "--help"):
            print(__doc__)
            return 0
        else:
            paths.append(Path(a))
        i += 1

    if not paths:
        sys.stderr.write("audit-isa: no ISA paths given\n")
        return 2

    if diff_mode:
        if len(paths) != 2:
            sys.stderr.write("--diff requires exactly two paths (old new)\n")
            return 2
        old = parse_isa(paths[0])
        new = parse_isa(paths[1])
        id_violations = audit_id_stability(old, new)
        defer_violations = deferred_resolution_violations(new, old)
        violations = id_violations + defer_violations
        if as_json:
            print(json.dumps({
                "id_stability_violations": id_violations,
                "deferred_resolution_violations": defer_violations,
            }, indent=2))
        else:
            if not violations:
                print(f"audit-isa --diff: id-stability OK ({len(old.iscs)} → {len(new.iscs)} ISCs)")
            else:
                if id_violations:
                    print(f"audit-isa --diff: {len(id_violations)} id-stability violation(s)")
                    for v in id_violations:
                        print(f"  {v}")
                if defer_violations:
                    print(f"audit-isa --diff: {len(defer_violations)} deferred-resolution violation(s)")
                    for v in defer_violations:
                        print(f"  {v}")
        if strict and violations:
            return 1
        return 0

    findings = [_audit_one(p) for p in paths]
    any_fail = any(
        f.get("missing_sections") or f.get("unverified") or
        f.get("order_violations") or f.get("error")
        for f in findings
    )
    if as_json:
        print(json.dumps({"isa_count": len(findings), "isas": findings}, indent=2))
    else:
        for f in findings:
            print(f"audit-isa: {f['path']}  tier={f['tier']!r}  phase={f['phase']!r}")
            print(f"  iscs: {f['iscs_total']} total ({f['iscs_done']} done, "
                  f"{f['iscs_anti']} anti, {f['iscs_antecedent']} antecedent, "
                  f"{f['iscs_tombstone']} tombstone)")
            if f.get("error"):
                print(f"  ERROR: {f['error']}")
            if f["missing_sections"]:
                print(f"  missing required sections for tier {f['tier']}: "
                      f"{', '.join(f['missing_sections'])}")
            if f["order_violations"]:
                print(f"  section-order violations:")
                for v in f["order_violations"]:
                    print(f"    {v}")
            if f["unverified"]:
                print(f"  unverified [x] ISCs (no Verification entry): "
                      f"{', '.join(f['unverified'])}")
            if f["deferred"]:
                print(f"  [DEFERRED-VERIFY] ISCs (linked task must close before "
                      f"phase: complete):")
                for isc_id, task in f["deferred"]:
                    print(f"    {isc_id} → task {task}")
    if strict and any_fail:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
