#!/usr/bin/env python3
"""HME Chain Snapshot — the compaction-replacement engine.

Produces a structured YAML chain-link artifact that preserves session state
across context compactions. Cheap to build (deterministic sections + optional
local-LLM narrative), dense (10x smaller than prose), and designed to be
loaded by postcompact as seed state for a fresh window.

Implements optimizations 2-13 from the compaction design. Optimization 1
(preemption trigger) lives in statusline.sh / posttooluse hooks which
invoke this script when used_pct crosses 70%.

Output: metrics/chain-history/link-<seq>-<timestamp>.yaml
Also updates:
  - metrics/chain-history/latest.yaml (symlink to newest)
  - metrics/chain-session-diff.txt (git diff from session start)
  - metrics/chain-session-commits.txt (commits this session)
  - tmp/hme-session-sha.txt (session start SHA for next snapshot)

Invocation modes:
  --eager     opportunistic snapshot during idle (no LLM)
  --imminent  context at 70%, full snapshot with local LLM narrative
  --replay SEQ  load and print a historical chain link
  --list      list all chain links in history
"""
import json
import os
import re
import subprocess
import sys
import time
from collections import Counter
from pathlib import Path

_PROJECT = os.environ.get("PROJECT_ROOT") or os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "..")
)
_METRICS = Path(os.environ.get("METRICS_DIR", os.path.join(_PROJECT, "output", "metrics")))
_HISTORY = _METRICS / "chain-history"
_SESSION_SHA = Path(_PROJECT) / "tmp" / "hme-session-sha.txt"
_CORRECTIONS = Path(_PROJECT) / "tmp" / "hme-user-corrections.jsonl"
_ENTANGLE = Path(_PROJECT) / "tmp" / "hme-entanglement.json"
_CTX_FILE = Path(os.environ.get("HME_CTX_FILE", "/tmp/claude-context.json"))


def _session_start_sha() -> str:
    if _SESSION_SHA.exists():
        return _SESSION_SHA.read_text().strip()
    # First run — pin current HEAD as session start
    try:
        sha = subprocess.run(
            ["git", "-C", _PROJECT, "log", "-1", "--format=%H"],
            capture_output=True, text=True, timeout=2,
        ).stdout.strip()
        _SESSION_SHA.parent.mkdir(exist_ok=True)
        _SESSION_SHA.write_text(sha)
        return sha
    except Exception:
        return ""


def _git_diff_section() -> dict:
    """Optimization 5: git diff as ground truth for 'what changed'."""
    start = _session_start_sha()
    if not start:
        return {"_warning": "no session SHA"}
    try:
        diff_stat = subprocess.run(
            ["git", "-C", _PROJECT, "diff", "--stat", f"{start}..HEAD"],
            capture_output=True, text=True, timeout=5,
        ).stdout.strip()
        commits = subprocess.run(
            ["git", "-C", _PROJECT, "log", "--oneline", f"{start}..HEAD"],
            capture_output=True, text=True, timeout=5,
        ).stdout.strip()
        uncommitted = subprocess.run(
            ["git", "-C", _PROJECT, "status", "--porcelain"],
            capture_output=True, text=True, timeout=3,
        ).stdout.strip()
        # Persist raw diff + commits for the chain link
        diff_file = _METRICS / "chain-session-diff.txt"
        commits_file = _METRICS / "chain-session-commits.txt"
        diff_file.parent.mkdir(exist_ok=True)
        diff_file.write_text(diff_stat)
        commits_file.write_text(commits)
        return {
            "session_start_sha": start[:12],
            "commits": [line for line in commits.splitlines() if line][:20],
            "files_touched": [
                line.strip().split("|")[0].strip()
                for line in diff_stat.splitlines()
                if "|" in line
            ][:30],
            "uncommitted_count": len([l for l in uncommitted.splitlines() if l.strip()]),
        }
    except Exception as e:
        return {"_error": str(e)}


def _corrections_section() -> list:
    """Optimization 6: user-correction channel."""
    if not _CORRECTIONS.exists():
        return []
    out = []
    try:
        with _CORRECTIONS.open() as f:
            for line in f:
                try:
                    out.append(json.loads(line))
                except Exception:
                    continue
    except Exception:
        pass
    return out[-20:]  # last 20 corrections


def _entanglement_section() -> dict:
    """Optimization 7: L17 entanglement as SEED, not footnote."""
    if not _ENTANGLE.exists():
        return {}
    try:
        return json.loads(_ENTANGLE.read_text())
    except Exception:
        return {}


def _hci_section() -> dict:
    """HCI + trajectory as health signal."""
    try:
        rc = subprocess.run(
            ["python3", os.path.join(_PROJECT, "tools", "HME", "scripts", "verify-coherence.py"), "--json"],
            capture_output=True, text=True, timeout=60,
            env={**os.environ, "PROJECT_ROOT": _PROJECT},
        )
        data = json.loads(rc.stdout)
        return {
            "hci": data.get("hci"),
            "verifier_count": data.get("verifier_count"),
            "fail_verifiers": [
                n for n, v in data.get("verifiers", {}).items()
                if v.get("status") == "FAIL"
            ],
            "warn_verifiers": [
                n for n, v in data.get("verifiers", {}).items()
                if v.get("status") == "WARN"
            ][:5],
        }
    except Exception:
        return {}


def _kb_section() -> dict:
    """Optimization 13: KB writes as persistent state — reference titles only."""
    recent_kb = []
    try:
        # Fetch last 10 entries by creation time via shim
        import urllib.request
        payload = json.dumps({
            "engine": "project", "method": "list_knowledge", "kwargs": {},
        }).encode()
        req = urllib.request.Request(
            "http://127.0.0.1:9098/rag", data=payload,
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=5) as r:
            result = json.loads(r.read()).get("result", [])
        recent_kb = [
            {"id": e.get("id", "")[:12], "title": e.get("title", "")[:120],
             "category": e.get("category", "")}
            for e in (result or [])[-15:]
        ]
    except Exception:
        pass
    return {
        "total_entries_fetchable_via": "learn(query=title)",
        "recent_entries": recent_kb,
    }


def _tool_usage_section() -> dict:
    """Optimization 9: tool call histogram, not narrative."""
    # Parse hook latency log for this session's tool usage
    hook_log = _METRICS / "hme-hook-latency.jsonl"
    counts: Counter = Counter()
    if hook_log.exists():
        try:
            start_ts = 0.0
            if _SESSION_SHA.exists():
                start_ts = _SESSION_SHA.stat().st_mtime
            with hook_log.open() as f:
                for line in f:
                    try:
                        e = json.loads(line)
                    except Exception:
                        continue
                    if e.get("ts", 0) < start_ts:
                        continue
                    counts[e.get("hook", "?")] += 1
        except Exception:
            pass
    return dict(counts.most_common(20))


def _onboarding_section() -> dict:
    state_file = Path(_PROJECT) / "tmp" / "hme-onboarding.state"
    target_file = Path(_PROJECT) / "tmp" / "hme-onboarding.target"
    return {
        "state": state_file.read_text().strip() if state_file.exists() else "graduated",
        "target": target_file.read_text().strip() if target_file.exists() else "",
    }


def _nexus_pending() -> list:
    nexus_file = Path(_PROJECT) / "tmp" / "hme-nexus.state"
    if not nexus_file.exists():
        return []
    try:
        lines = nexus_file.read_text().splitlines()
    except Exception:
        return []
    return [line for line in lines if line.strip()][-20:]


def _ctx_usage() -> dict:
    if not _CTX_FILE.exists():
        return {}
    try:
        return json.loads(_CTX_FILE.read_text())
    except Exception:
        return {}


def _next_seq() -> int:
    _HISTORY.mkdir(parents=True, exist_ok=True)
    existing = sorted(_HISTORY.glob("link-*.yaml"))
    if not existing:
        return 1
    last = existing[-1].stem
    m = re.match(r"link-(\d+)-", last)
    return int(m.group(1)) + 1 if m else len(existing) + 1


def _prior_link_summary() -> dict:
    """Optimization 3: delta-only — reference the previous link, don't re-summarize."""
    if not _HISTORY.exists():
        return {}
    existing = sorted(_HISTORY.glob("link-*.yaml"))
    if not existing:
        return {}
    latest = existing[-1]
    return {
        "prior_link_file": latest.name,
        "prior_link_captured_at": time.strftime(
            "%Y-%m-%d %H:%M:%S", time.localtime(latest.stat().st_mtime)
        ),
    }


def _narrative_via_local_llm(mode: str, sections: dict) -> str:
    """Optimization 4: use local LLM for the ONE part that needs prose —
    the why-we-made-these-decisions distillation. Zero Claude tokens."""
    if mode == "eager":
        return ""  # eager snapshots skip LLM entirely
    try:
        import urllib.request
        prompt = (
            "Given this structured session state, write 3-5 sentences about the "
            "MOST RECENT decisions and the reasoning behind them. Only describe "
            "decisions, not routine work. No fluff.\n\n"
            f"Session state:\n{json.dumps(sections, indent=2, default=str)[:4000]}\n\n"
            "3-5 sentences of decision rationale:"
        )
        payload = json.dumps({
            "model": "qwen3:30b-a3b",
            "prompt": prompt,
            "stream": False,
            "options": {"num_predict": 300, "temperature": 0.3},
        }).encode()
        req = urllib.request.Request(
            "http://127.0.0.1:11435/api/generate", data=payload,
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=60) as r:
            return (json.loads(r.read()).get("response") or "").strip()[:1500]
    except Exception as e:
        return f"[local LLM unavailable: {e}]"


def build_snapshot(mode: str = "imminent") -> dict:
    sections = {
        "schema_version": 1,
        "captured_at": time.time(),
        "captured_at_human": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime()),
        "mode": mode,
        "project_root": _PROJECT,
        # Seed — the persistent self-model (optimization 7)
        "entanglement": _entanglement_section(),
        # Ground truth — what the session did to the code (optimization 5)
        "git_delta": _git_diff_section(),
        # Critical preservation — user corrections (optimization 6)
        "user_corrections": _corrections_section(),
        # Persistent state — KB entry titles, content fetchable (optimization 13)
        "kb": _kb_section(),
        # Session metadata
        "onboarding": _onboarding_section(),
        "nexus_pending": _nexus_pending(),
        "hci": _hci_section(),
        "tool_usage": _tool_usage_section(),
        "context_meter": _ctx_usage(),
        # Delta-only reference (optimization 3)
        "prior_link": _prior_link_summary(),
    }
    # Narrative distillation via local LLM (optimization 4)
    sections["decision_rationale"] = _narrative_via_local_llm(mode, sections)
    return sections


def write_snapshot(snap: dict) -> Path:
    _HISTORY.mkdir(parents=True, exist_ok=True)
    seq = _next_seq()
    ts = time.strftime("%Y%m%d-%H%M%S", time.localtime())
    out = _HISTORY / f"link-{seq:04d}-{ts}.yaml"
    # Use a minimal YAML format (JSON is valid YAML)
    out.write_text(json.dumps(snap, indent=2, default=str))
    # Update latest pointer (optimization 11 — versioning)
    latest = _HISTORY / "latest.yaml"
    try:
        if latest.exists() or latest.is_symlink():
            latest.unlink()
        latest.symlink_to(out.name)
    except Exception:
        pass
    return out


def cmd_eager() -> int:
    snap = build_snapshot(mode="eager")
    out = write_snapshot(snap)
    print(f"[chain-snapshot eager] {out.name}")
    print(f"  git delta: {len(snap['git_delta'].get('commits', []))} commits, "
          f"{len(snap['git_delta'].get('files_touched', []))} files touched")
    print(f"  hci: {snap['hci'].get('hci', '?')}")
    return 0


def cmd_imminent() -> int:
    snap = build_snapshot(mode="imminent")
    out = write_snapshot(snap)
    print(f"[chain-snapshot IMMINENT] {out.name}")
    ctx = snap.get("context_meter", {})
    print(f"  context used: {ctx.get('used_pct', '?')}%")
    print(f"  decision rationale: {snap['decision_rationale'][:200]}")
    return 0


def cmd_list() -> int:
    _HISTORY.mkdir(parents=True, exist_ok=True)
    links = sorted(_HISTORY.glob("link-*.yaml"))
    if not links:
        print("[chain-history empty]")
        return 0
    print(f"# Chain history ({len(links)} links)")
    for link in links:
        try:
            data = json.loads(link.read_text())
            ts = data.get("captured_at_human", "?")
            hci = data.get("hci", {}).get("hci", "?")
            corrections = len(data.get("user_corrections", []))
            commits = len(data.get("git_delta", {}).get("commits", []))
            print(f"  {link.name}: {ts}  hci={hci}  corrections={corrections}  commits={commits}")
        except Exception as e:
            print(f"  {link.name}: [parse error: {e}]")
    return 0


def cmd_replay(seq_arg: str) -> int:
    _HISTORY.mkdir(parents=True, exist_ok=True)
    matches = sorted(_HISTORY.glob(f"link-{int(seq_arg):04d}-*.yaml"))
    if not matches:
        print(f"[no chain link with sequence {seq_arg}]")
        return 2
    data = json.loads(matches[0].read_text())
    print(f"# Chain link replay: {matches[0].name}")
    print(json.dumps(data, indent=2, default=str))
    return 0


def main(argv: list) -> int:
    if "--list" in argv:
        return cmd_list()
    if "--replay" in argv:
        idx = argv.index("--replay")
        if idx + 1 >= len(argv):
            print("--replay requires a sequence number")
            return 2
        return cmd_replay(argv[idx + 1])
    if "--eager" in argv:
        return cmd_eager()
    if "--imminent" in argv:
        return cmd_imminent()
    # Default: eager snapshot
    return cmd_eager()


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
