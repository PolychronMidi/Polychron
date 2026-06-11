#!/usr/bin/env python3
"""Run a mesh consultation from a manifest embedded in its context file.

The context markdown owns the round shape. This runner is the single reusable
executor: no per-consult shell script should duplicate dispatch/progress logic.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

ROOT = Path(os.environ.get("PROJECT_ROOT") or Path.cwd()).resolve()
MANIFEST_RE = re.compile(r"```(?:json\s+)?mesh_consult\s*\n(.*?)\n```", re.S | re.I)
DEFAULT_DASHBOARD = {
    "agents": {
        "driver": {"role": "driver", "status": "registered", "tier": "E5", "ctx_used_pct": 5},
        "red_lead": {"role": "red_lead", "status": "registered", "tier": "E5", "ctx_used_pct": 8},
        "blue_lead": {"role": "blue_lead", "status": "registered", "tier": "E5", "ctx_used_pct": 10},
        "red_purple": {"role": "red_purple", "status": "registered", "tier": "E4", "ctx_used_pct": 18},
        "blue_purple": {"role": "blue_purple", "status": "registered", "tier": "E4", "ctx_used_pct": 22},
    }
}
REQUIRED_STEP = ("id", "caller", "tier", "depth", "channel", "target", "message")
REPLY_REF_RE = re.compile(r"\{reply:([^}]+)\}")


def rel(path: Path) -> str:
    try:
        return str(path.resolve().relative_to(ROOT))
    except ValueError:
        return str(path)


def load_manifest(ctx: Path) -> dict[str, Any]:
    text = ctx.read_text(encoding="utf-8")
    match = MANIFEST_RE.search(text)
    if not match:
        raise SystemExit(f"{rel(ctx)} missing fenced ```mesh_consult manifest")
    try:
        data = json.loads(match.group(1))
    except json.JSONDecodeError as exc:
        raise SystemExit(f"{rel(ctx)} mesh_consult JSON invalid: {exc}") from exc
    if not isinstance(data, dict):
        raise SystemExit("mesh_consult manifest must be a JSON object")
    for key in ("round", "scope", "artifact", "steps", "final_outputs"):
        if key not in data:
            raise SystemExit(f"mesh_consult manifest missing {key}")
    if not isinstance(data["steps"], list) or not data["steps"]:
        raise SystemExit("mesh_consult steps must be a non-empty list")
    seen: set[str] = set()
    for idx, step in enumerate(data["steps"]):
        if not isinstance(step, dict):
            raise SystemExit(f"step {idx} must be an object")
        for key in REQUIRED_STEP:
            if key not in step:
                raise SystemExit(f"step {idx} missing {key}")
        sid = str(step["id"])
        if sid in seen:
            raise SystemExit(f"duplicate step id {sid}")
        seen.add(sid)
    finals = data["final_outputs"]
    if not isinstance(finals, list) or not finals or any(str(f) not in seen for f in finals):
        raise SystemExit("final_outputs must name existing step ids")
    return data


def fsync_append_jsonl(path: Path, row: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(row, sort_keys=True) + "\n")
        f.flush()
        os.fsync(f.fileno())


class Progress:
    def __init__(self, path: Path, round_name: str, total: int) -> None:
        self.path = path
        self.round = round_name
        self.total = total
        self.done = 0
        self.failed = 0
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("", encoding="utf-8")
        self.emit("round", "start", f"{round_name} ({total} steps)")

    def emit(self, step: str, status: str, detail: str = "", **extra: Any) -> None:
        if step != "round" and status in {"done", "failed"}:
            self.done += 1
        if step != "round" and status == "failed":
            self.failed += 1
        row: dict[str, Any] = {
            "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "round": self.round,
            "step": step,
            "status": status,
            "detail": detail,
            "progress": f"{self.done}/{self.total}",
        }
        row.update({k: v for k, v in extra.items() if v not in (None, "")})
        fsync_append_jsonl(self.path, row)
        line = f"[{row['ts']}] [{row['progress']}] {step}: {status}"
        if row.get("target"):
            line += f" target={row['target']}"
        if "rc" in row:
            line += f" rc={row['rc']}"
        if "reply_bytes" in row:
            line += f" reply_bytes={row['reply_bytes']}"
        if row.get("error_log"):
            line += f" error_log={row['error_log']}"
        if detail:
            line += f" -- {detail}"
        print(line, flush=True)

    def finish(self, detail: str) -> int:
        if self.failed:
            self.emit("round", "failed", f"{detail}; {self.failed} step(s) failed")
            return 1
        self.emit("round", "done", detail)
        return 0


def setup_round(manifest: dict[str, Any], out_dir: Path) -> None:
    (ROOT / "tools/HME/runtime/team-dashboard.json").write_text(
        json.dumps(manifest.get("dashboard") or DEFAULT_DASHBOARD, separators=(",", ":")),
        encoding="utf-8",
    )
    budget = ROOT / "tools/HME/runtime/team-dispatch-budget.json"
    try:
        budget.unlink()
    except FileNotFoundError:
        pass  # silent-ok: pending review
    for channel in ("red", "blue", "purple", "driver"):
        p = ROOT / "teams" / f"{channel}.md"
        if not p.exists() or p.stat().st_size == 0:
            p.write_text(f"# {channel} channel\n", encoding="utf-8")
    out_dir.mkdir(parents=True, exist_ok=True)
    for old in out_dir.glob("*.json"):
        old.unlink()
    err = out_dir / "consult.err"
    err.write_text("", encoding="utf-8")


def reply_text(out_dir: Path, sid: str) -> str:
    try:
        data = json.loads((out_dir / sid).read_text(encoding="utf-8"))
        return str(data.get("reply") or "")
    except (OSError, json.JSONDecodeError):
        return ""


def sanitize(text: str) -> str:
    return re.sub(r"^#{1,6} ", "  ", text, flags=re.M).replace("GAP:", "gap:")


def render_message(template: str, out_dir: Path) -> str:
    def repl(match: re.Match[str]) -> str:
        return sanitize(reply_text(out_dir, match.group(1).strip()))
    return REPLY_REF_RE.sub(repl, template)


def run_step(step: dict[str, Any], manifest: dict[str, Any], ctx: Path, out_dir: Path, err: Path) -> tuple[int, int]:
    dur = int(os.environ.get(str(manifest.get("duration_env") or ""), str(manifest.get("duration_default", 900))))
    guard = Path(os.environ.get("HME_MESH_CONSULT_GUARD") or ROOT / "tools/HME/scripts/team_dispatch_guard.py")
    cmd = [
        sys.executable, str(guard), "--caller", str(step["caller"]), "--tier", str(step["tier"]),
        "--depth", str(step["depth"]), "--max-depth", str(manifest.get("max_depth", 4)),
        "--turn-id", str(step["id"]), "--budget", str(manifest.get("budget", 4)),
        "--max-live", str(manifest.get("max_live", 30)), "--scope", str(manifest["scope"]),
        "--artifact", str(manifest["artifact"]), "--max-duration", str(dur),
        "--max-tools", str(manifest.get("max_tools", 8)), "--target", str(step["target"]),
        "--context-file", str(ctx), "--context-cap", str(manifest.get("context_cap", 300000)),
        "--send", "--message", render_message(str(step["message"]), out_dir),
    ]
    env = os.environ.copy()
    env.update({"PROJECT_ROOT": str(ROOT), "HME_ASK_PEER_PROJECT_ROOT": str(ROOT),
                "HME_TEAM_MAX_REPLY_BYTES": str(manifest.get("reply_bytes", 14000))})
    try:
        proc = subprocess.run(cmd, cwd=ROOT, env=env, text=True, capture_output=True, timeout=dur + 45, check=False)
        (out_dir / str(step["id"])).write_text(proc.stdout, encoding="utf-8")
        with err.open("a", encoding="utf-8") as f:
            f.write(proc.stderr or "")
        rc = int(proc.returncode)
    except subprocess.TimeoutExpired as exc:
        (out_dir / str(step["id"])).write_text(exc.stdout or "", encoding="utf-8")
        with err.open("a", encoding="utf-8") as f:
            f.write(f"step {step['id']} runner timeout\n{exc.stderr or ''}")
        rc = 124
    return rc, len(reply_text(out_dir, str(step["id"])).encode("utf-8"))


def relevant_output_paths(manifest: dict[str, Any], out_dir: Path) -> list[Path]:
    paths = [out_dir / "_consult-complete.json", out_dir / "round-progress.jsonl", out_dir / "consult.err"]
    paths.extend(out_dir / str(step["id"]) for step in manifest["steps"])
    seen: set[Path] = set()
    out: list[Path] = []
    for p in paths:
        if p in seen:
            continue
        seen.add(p)
        if p.exists():
            out.append(p)
    return out


def write_completion(manifest: dict[str, Any], ctx: Path, out_dir: Path, ok: bool) -> None:
    finals = [str(f) for f in manifest["final_outputs"]]
    required = [str(s["id"]) for s in manifest["steps"]]
    complete = ok and all(reply_text(out_dir, f) for f in finals)
    auto_read = [rel(p) for p in relevant_output_paths(manifest, out_dir)]
    payload = {
        "schema": 1,
        "complete": complete,
        "round": manifest["round"],
        "context_file": rel(ctx),
        "output_dir": rel(out_dir),
        "required_outputs": [rel(out_dir / s) for s in required],
        "final_outputs": [rel(out_dir / f) for f in finals],
        "must_read_before_report": [rel(out_dir / f) for f in finals],
        "native_read_before_report": auto_read,
        "read_queue": rel(out_dir / "_consult-read-queue.json"),
        "completed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()) if complete else "",
        "premature_report_guard": "Do not report mesh conclusions until every native_read_before_report file has been read through Claude's native Read tool after completion.",
        "polling_guard": "Do not poll task output/progress. After completion, issue native Read calls for every native_read_before_report path.",
    }
    (out_dir / "_consult-complete.json").write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def write_native_read_queue(manifest: dict[str, Any], out_dir: Path) -> Path:
    files = [rel(p) for p in relevant_output_paths(manifest, out_dir)]
    generated_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    nonce = f"{manifest['round']}-{int(time.time())}-{os.getpid()}"
    session_id = os.environ.get("CLAUDE_CODE_SESSION_ID") or os.environ.get("HME_SESSION_ID") or ""
    ttl = int(os.environ.get("HME_CONSULT_READ_QUEUE_TTL", "3600"))
    payload = {
        "schema": 1,
        "round": manifest["round"],
        "generated_at": generated_at,
        "nonce": nonce,
        "source": "consult_from_context.write_native_read_queue",
        "guard": "These paths must be read with Claude's native Read tool before reporting. This file is a queue, not evidence that reads happened.",
        "native_read_before_report": files,
    }
    out_path = out_dir / "_consult-read-queue.json"
    out_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    latest_path = ROOT / "tools/HME/runtime/latest-consult-read-queue.json"
    latest_path.parent.mkdir(parents=True, exist_ok=True)
    latest_path.write_text(json.dumps({
        "schema": 1,
        "round": manifest["round"],
        "read_queue": rel(out_path),
        "native_read_before_report": files,
        "generated_at": generated_at,
        "nonce": nonce,
        "session_id": session_id,
        "expires_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() + ttl)),
        "consumed": False,
    }, indent=2) + "\n", encoding="utf-8")
    print(f"NATIVE_READ_QUEUE {rel(out_path)}", flush=True)
    for item in files:
        print(f"NATIVE_READ_REQUIRED {item}", flush=True)
    return out_path


def _project_slug(root: Path = ROOT) -> str:
    return str(root.resolve()).replace("/", "-")


def _session_id() -> str:
    for key in ("CLAUDE_CODE_SESSION_ID", "HME_SESSION_ID", "CLAUDE_SESSION_ID"):
        val = os.environ.get(key)
        if val:
            return val
    return ""


def _claude_projects_dir() -> Path:
    return Path(os.environ.get("CLAUDE_PROJECT_DIR") or Path.home() / ".claude" / "projects")


def resolve_transcript_path(session_id: str = "") -> Path | None:
    explicit = os.environ.get("HME_TRANSCRIPT_PATH") or os.environ.get("CLAUDE_TRANSCRIPT_PATH")
    if explicit:
        p = Path(explicit)
        if p.exists():
            return p
    projects = _claude_projects_dir()
    if not projects.exists():
        return None
    if session_id:
        matches = sorted(projects.rglob(f"{session_id}.jsonl"), key=lambda p: p.stat().st_mtime, reverse=True)
        if matches:
            return matches[0]
    slug_dir = projects / _project_slug(ROOT)
    search_dir = slug_dir if slug_dir.exists() else projects
    matches = sorted(search_dir.rglob("*.jsonl"), key=lambda p: p.stat().st_mtime, reverse=True)
    return matches[0] if matches else None


def _line_count(path_: Path) -> int:
    try:
        with path_.open("r", encoding="utf-8", errors="ignore") as f:
            return sum(1 for _ in f)
    except OSError:
        return 0


def _abs_path(path_: str) -> str:
    p = Path(path_)
    return str((p if p.is_absolute() else ROOT / p).resolve())


def _rel_or_abs(path_: str) -> str:
    p = Path(path_)
    try:
        return str(p.resolve().relative_to(ROOT)) if p.is_absolute() else str(p)
    except ValueError:
        return str(path_)


def collect_native_read_rows(transcript: Path, required_files: list[str], start_line: int = 0) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Collect post-completion native Read rows with accepted read-chain provenance."""
    required_abs = {_abs_path(f) for f in required_files}
    rows_by_id: dict[str, dict[str, Any]] = {}
    rejected: list[dict[str, Any]] = []
    try:
        lines = transcript.read_text(encoding="utf-8", errors="ignore").splitlines()
    except OSError:
        return [], []
    for line_no, line in enumerate(lines, 1):
        if line_no <= start_line:
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        msg = event.get("message") or {}
        content = msg.get("content")
        if not isinstance(content, list):
            continue
        for block in content:
            if not isinstance(block, dict):
                continue
            if block.get("type") == "tool_use" and block.get("name") == "Read":
                tool_id = str(block.get("id") or "")
                raw_path = str((block.get("input") or {}).get("file_path") or "")
                abs_path = _abs_path(raw_path) if raw_path else ""
                if abs_path not in required_abs:
                    continue
                if tool_id.startswith("hme_consult_auto_read_"):
                    rejected.append({"line": line_no, "tool_use_id": tool_id, "file_path": raw_path, "reason": "retired-synthetic-auto-read-id"})
                    continue
                if not tool_id.startswith("hme_read_chain__"):
                    rejected.append({"line": line_no, "tool_use_id": tool_id, "file_path": raw_path, "reason": "missing-read-chain-provenance"})
                    continue
                rows_by_id[tool_id] = {
                    "line": line_no,
                    "timestamp": event.get("timestamp") or "",
                    "tool_use_id": tool_id,
                    "file_path": raw_path,
                    "relative_path": _rel_or_abs(raw_path),
                    "result_line": 0,
                    "result_timestamp": "",
                }
            elif block.get("type") == "tool_result":
                tool_id = str(block.get("tool_use_id") or "")
                if tool_id in rows_by_id and not rows_by_id[tool_id].get("result_line"):
                    rows_by_id[tool_id]["result_line"] = line_no
                    rows_by_id[tool_id]["result_timestamp"] = event.get("timestamp") or ""
    rows = sorted(rows_by_id.values(), key=lambda r: (str(r.get("relative_path")), int(r.get("line") or 0)))
    return rows, rejected


def write_native_read_proof(out_dir: Path, proof: dict[str, Any]) -> None:
    (out_dir / "_consult-native-read-proof.json").write_text(json.dumps(proof, indent=2) + "\n", encoding="utf-8")


def prove_native_reads(manifest: dict[str, Any], out_dir: Path, files: list[str]) -> bool:
    timeout = int(os.environ.get("HME_CONSULT_NATIVE_READ_PROOF_TIMEOUT", "180"))
    session_id = _session_id()
    transcript = resolve_transcript_path(session_id)
    proof: dict[str, Any] = {
        "schema": 1,
        "round": manifest["round"],
        "verified": False,
        "session_id": session_id,
        "transcript_path": str(transcript or ""),
        "required_reads": [_rel_or_abs(f) for f in files],
        "read_rows": [],
        "missing": [_rel_or_abs(f) for f in files],
        "rejected_rows": [],
        "started_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    if not transcript:
        proof["failure"] = "no Claude transcript resolved; cannot prove native Read tool execution"
        write_native_read_proof(out_dir, proof)
        print("NATIVE_READ_PROOF_FAILED no-transcript", flush=True)
        return False
    start_line = _line_count(transcript)
    proof["start_line"] = start_line
    driver = os.environ.get("HME_CONSULT_NATIVE_READ_PROOF_DRIVER", "read-chain")
    nonce = f"{manifest['round']}-{int(time.time())}-{os.getpid()}" if driver == "claude-print" else ""
    proc = _spawn_claude_read_driver(session_id or transcript.stem, files, out_dir, timeout, nonce) if driver == "claude-print" else None
    proof["proof_mode"] = "proxy-task-notification-read-chain" if not proc else "claude-print"
    proof["queued"] = True
    proof["failure"] = None
    gate_nonce = nonce if proc else ""
    proof["provenance_gated"] = bool(gate_nonce)
    if not proc:
        print("NATIVE_READ_PROOF_QUEUED proxy read_chain will run on host task-notification", flush=True)
    deadline = time.time() + timeout
    required = {_rel_or_abs(f) for f in files}
    try:
        while time.time() < deadline:
            rows, rejected = collect_native_read_rows(transcript, files, start_line, gate_nonce)
            covered = {str(r.get("relative_path")) for r in rows if int(r.get("result_line") or 0) > 0}
            missing = sorted(required - covered)
            proof.update({
                "read_rows": rows,
                "rejected_rows": rejected,
                "missing": missing,
                "checked_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            })
            if not missing:
                proof["verified"] = True
                write_native_read_proof(out_dir, proof)
                print(f"NATIVE_READ_PROOF_OK {rel(out_dir / '_consult-native-read-proof.json')}", flush=True)
                for row in rows:
                    if row.get("relative_path") in required:
                        print(f"NATIVE_READ_PROOF_ROW line={row.get('line')} result_line={row.get('result_line')} id={row.get('tool_use_id')} path={row.get('relative_path')}", flush=True)
                return True
            if proc and proc.poll() is not None and time.time() > deadline - max(5, timeout // 4):
                break
            time.sleep(1.0)
    finally:
        if proc and proc.poll() is None:
            try:
                proc.terminate()
            except OSError:
                pass  # silent-ok: pending review
    if proof.get("read_rows"):
        proof["failure"] = "native Read proof incomplete after observed post-completion Read rows"
        proof["pending_read_chain_on_task_notification"] = False
        write_native_read_proof(out_dir, proof)
        print(f"NATIVE_READ_PROOF_FAILED missing={','.join(proof['missing'])}", flush=True)
        return False
    proof["failure"] = None
    proof["pending_read_chain_on_task_notification"] = True
    write_native_read_proof(out_dir, proof)
    print(f"NATIVE_READ_PROOF_PENDING missing={','.join(proof['missing'])}", flush=True)
    return True


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Run mesh consultation from a context-file manifest")
    ap.add_argument("context_file")
    ns = ap.parse_args(argv)
    ctx = Path(ns.context_file)
    if not ctx.is_absolute():
        ctx = ROOT / ctx
    manifest = load_manifest(ctx)
    out_dir = ROOT / "teams/runtime/output" / str(manifest["round"])
    setup_round(manifest, out_dir)
    progress = Progress(out_dir / "round-progress.jsonl", str(manifest["round"]), len(manifest["steps"]))
    err = out_dir / "consult.err"
    ok = True
    for step in manifest["steps"]:
        progress.emit(str(step["id"]), "dispatching", f"{step['caller']} -> {step['target']} via teams/{step['channel']}.md", target=str(step["target"]))
        rc, bytes_ = run_step(step, manifest, ctx, out_dir, err)
        if rc == 0 and bytes_ > 2:
            progress.emit(str(step["id"]), "done", "reply captured", target=str(step["target"]), rc=rc, reply_bytes=bytes_)
        else:
            ok = False
            progress.emit(str(step["id"]), "failed", "dispatch failed", target=str(step["target"]), rc=rc, reply_bytes=bytes_, error_log=rel(err))
    write_completion(manifest, ctx, out_dir, ok)
    proof_ok = True
    if ok:
        files = [rel(p) for p in relevant_output_paths(manifest, out_dir)]
        write_native_read_queue(manifest, out_dir)
        proof_ok = prove_native_reads(manifest, out_dir, files)
        write_completion(manifest, ctx, out_dir, ok)
    rc = progress.finish(f"{manifest['round']} consultation complete" if ok else f"{manifest['round']} consultation incomplete")
    if ok and not proof_ok:
        rc = 1
    print(rel(out_dir), flush=True)
    return rc


if __name__ == "__main__":
    raise SystemExit(main())
