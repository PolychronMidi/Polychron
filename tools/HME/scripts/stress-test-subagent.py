#!/usr/bin/env python3
"""Adversarial stress test battery for agent_local.py.

Runs a fixed set of challenging prompts against the local subagent and
scores each response against expected properties. Designed to catch quality
regressions without requiring manual review of every answer.

Each test case declares:
    prompt: the question to ask
    mode: 'explore' or 'plan'
    must_contain: list of substrings that MUST appear in the answer (all of them)
    must_not_contain: substrings that MUST NOT appear (any match = fail)
    min_tools: minimum number of tools the agent should have used
    timeout_s: max seconds to wait for this test

Exit code 0 = all pass, 1 = one or more failed, 2 = engine error.

Usage:
    python3 tools/HME/scripts/stress-test-subagent.py
    python3 tools/HME/scripts/stress-test-subagent.py --only 1,3,5
    python3 tools/HME/scripts/stress-test-subagent.py --timeout-mult 2
"""
import json
import os
import subprocess
import sys
import time

_PROJECT = os.environ.get("PROJECT_ROOT") or os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "..")
)
_AGENT = os.path.join(_PROJECT, "tools", "HME", "mcp", "agent_local.py")

# ── Stress test battery ──
# Each case targets a specific failure mode observed in the wild.
TESTS = [
    {
        "id": 1,
        "name": "short-prompt guard",
        "prompt": "?",
        "mode": "explore",
        "must_contain": ["declined", "short"],
        "must_not_contain": ["Error", "Traceback"],
        "min_tools": 1,
        "timeout_s": 10,  # guard should fire in <1s
    },
    {
        "id": 2,
        "name": "known file lookup (ground truth)",
        "prompt": "List all files that source _tab_helpers.sh in tools/HME/hooks/",
        "mode": "explore",
        "must_contain": [
            "posttooluse_agent.sh",
            "posttooluse_bash.sh",
            "posttooluse_write.sh",
            "posttooluse_addknowledge.sh",
        ],
        "must_not_contain": ["cannot provide", "no information"],
        "min_tools": 3,
        "timeout_s": 360,
    },
    {
        "id": 3,
        "name": "nonexistent file (should NOT hallucinate)",
        "prompt": "Where is the file crossLayerFakeNonExistent123.js and what does it do?",
        "mode": "explore",
        "must_contain": [],  # any answer is fine
        "must_not_contain": ["line 1:", "defined in src/crossLayer/crossLayerFakeNonExistent123.js"],
        "min_tools": 2,
        "timeout_s": 360,
    },
    {
        "id": 4,
        "name": "decorator counting",
        "prompt": "Which files in tools/HME/mcp/server/ contain @ctx.mcp.tool() decorators?",
        "mode": "explore",
        "must_contain": ["evolve", "learn", "review", "trace"],  # at least the public tools
        "must_not_contain": ["cannot locate", "no entries"],
        "min_tools": 3,
        "timeout_s": 360,
    },
    {
        "id": 5,
        "name": "plan mode",
        "prompt": "Plan how to add a simple health check endpoint to tools/HME/mcp/hme_http.py",
        "mode": "plan",
        "must_contain": ["hme_http"],  # plan should name the target file
        "must_not_contain": [],
        "min_tools": 3,
        "timeout_s": 420,
    },
]


def run_case(case: dict, timeout_mult: float = 1.0) -> dict:
    t0 = time.time()
    payload = json.dumps({"prompt": case["prompt"], "mode": case["mode"]})
    try:
        proc = subprocess.run(
            ["python3", _AGENT, "--stdin", "--json", "--project", _PROJECT],
            input=payload, capture_output=True, text=True,
            timeout=int(case["timeout_s"] * timeout_mult),
            env={**os.environ, "PROJECT_ROOT": _PROJECT},
        )
    except subprocess.TimeoutExpired:
        return {
            "id": case["id"], "name": case["name"], "passed": False,
            "reason": "TIMEOUT", "elapsed": time.time() - t0,
        }
    elapsed = time.time() - t0
    try:
        result = json.loads(proc.stdout)
    except Exception as e:
        return {
            "id": case["id"], "name": case["name"], "passed": False,
            "reason": f"JSON decode failed: {e}", "elapsed": elapsed,
            "stdout_head": proc.stdout[:500],
        }
    answer = (result.get("answer") or "").lower()
    tools = result.get("tools_used", [])
    missing = [s for s in case["must_contain"] if s.lower() not in answer]
    forbidden = [s for s in case["must_not_contain"] if s.lower() in answer]
    passed = (
        not missing
        and not forbidden
        and len(tools) >= case["min_tools"]
    )
    return {
        "id": case["id"], "name": case["name"],
        "passed": passed,
        "missing": missing,
        "forbidden": forbidden,
        "tools_count": len(tools),
        "min_tools": case["min_tools"],
        "elapsed": round(elapsed, 1),
        "model": result.get("model", "?"),
        "answer_preview": result.get("answer", "")[:300],
    }


def main(argv: list) -> int:
    only: set = set()
    timeout_mult = 1.0
    for i, a in enumerate(argv):
        if a == "--only" and i + 1 < len(argv):
            only = {int(x) for x in argv[i + 1].split(",")}
        elif a == "--timeout-mult" and i + 1 < len(argv):
            try:
                timeout_mult = float(argv[i + 1])
            except ValueError:
                pass

    results = []
    for case in TESTS:
        if only and case["id"] not in only:
            continue
        print(f"[{case['id']}] {case['name']} ...", flush=True)
        r = run_case(case, timeout_mult=timeout_mult)
        results.append(r)
        status = "PASS" if r["passed"] else "FAIL"
        print(f"  {status} ({r.get('elapsed', '?')}s, {r.get('tools_count', '?')} tools)")
        if not r["passed"]:
            if r.get("missing"):
                print(f"    missing: {r['missing']}")
            if r.get("forbidden"):
                print(f"    forbidden: {r['forbidden']}")
            if "reason" in r:
                print(f"    reason: {r['reason']}")
            print(f"    preview: {r.get('answer_preview', '')[:200]}")

    passed = sum(1 for r in results if r["passed"])
    total = len(results)
    print(f"\n# RESULT: {passed}/{total} passed")
    return 0 if passed == total else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
