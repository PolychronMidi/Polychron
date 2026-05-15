#!/usr/bin/env python3
"""Run a Codex CLI task through the HME filesystem job contract."""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path


PROJECT_ROOT = Path(os.environ.get("PROJECT_ROOT", Path(__file__).resolve().parents[2]))
HME_SCRIPTS = PROJECT_ROOT / "tools" / "HME" / "scripts"
sys.path.insert(0, str(HME_SCRIPTS))

from agent_jobs import create_job, latest_job, read_status, update_status  # noqa: E402


_SESSION_KEYS = {"session_id", "sessionId", "conversation_id", "conversationId", "thread_id", "threadId"}
_UUID_RE = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")


def _prompt(args: argparse.Namespace) -> str:
    if args.prompt_file:
        return Path(args.prompt_file).read_text(encoding="utf-8")
    if args.prompt:
        return args.prompt
    return sys.stdin.read()


def _runtime_prompt(prompt: str, system: str) -> str:
    if not system:
        return prompt
    return f"System instructions:\n{system}\n\nTask:\n{prompt}"


def _walk_json(value):
    if isinstance(value, dict):
        for key, item in value.items():
            if key in _SESSION_KEYS and isinstance(item, str) and item:
                yield item
            yield from _walk_json(item)
    elif isinstance(value, list):
        for item in value:
            yield from _walk_json(item)


def _extract_session_id(stdout_jsonl: Path) -> str:
    try:
        for line in stdout_jsonl.read_text(encoding="utf-8", errors="replace").splitlines():
            try:
                payload = json.loads(line)
            except json.JSONDecodeError:
                continue
            for candidate in _walk_json(payload):
                if _UUID_RE.fullmatch(candidate):
                    return candidate
    except OSError:
        return ""
    return ""


def _codex_cmd(args: argparse.Namespace, job: Path) -> list[str]:
    out = job / "output.txt"
    if args.session_id or args.last:
        cmd = ["codex", "exec", "resume", "--json", "-o", str(out)]
        if args.model:
            cmd.extend(["--model", args.model])
        if args.last:
            cmd.append("--last")
        else:
            cmd.append(args.session_id)
        cmd.append("-")
        return cmd
    cmd = ["codex", "exec", "--json", "-o", str(out), "--cd", str(PROJECT_ROOT)]
    if args.model:
        cmd.extend(["--model", args.model])
    cmd.append("-")
    return cmd


def cmd_run(args: argparse.Namespace) -> int:
    prompt = _prompt(args)
    runtime_prompt = _runtime_prompt(prompt, args.system or "")
    job = create_job(
        args.role,
        prompt,
        system=args.system or "",
        session_id=args.session_id or "",
        model=args.model or "",
        metadata={"launcher": "codex-agent-job"},
    )
    stdout_path = job / "stdout.jsonl"
    stderr_path = job / "stderr.txt"
    cmd = _codex_cmd(args, job)
    update_status(job, "running", command=cmd)
    env = {**os.environ, "PROJECT_ROOT": str(PROJECT_ROOT)}
    with open(stdout_path, "w", encoding="utf-8") as out, open(stderr_path, "w", encoding="utf-8") as err:
        try:
            proc = subprocess.run(cmd, input=runtime_prompt, text=True, stdout=out, stderr=err, env=env, timeout=args.timeout or None)
        except subprocess.TimeoutExpired as exc:
            err.write(f"codex-agent-job timeout after {exc.timeout}s\n")
            update_status(job, "failed", error="timeout", returncode=124)
            print(job)
            return 124
        except FileNotFoundError as exc:
            err.write(f"codex CLI not found: {exc}\n")
            update_status(job, "failed", error="codex_not_found", returncode=127)
            print(job)
            return 127
    sid = args.session_id or _extract_session_id(stdout_path)
    state = "complete" if proc.returncode == 0 else "failed"
    update_status(job, state, returncode=proc.returncode, session_id=sid)
    print(job)
    return proc.returncode


def cmd_status(args: argparse.Namespace) -> int:
    job = Path(args.job) if args.job else latest_job(args.role)
    if job is None:
        print(f"no job for role={args.role}", file=sys.stderr)
        return 1
    print(json.dumps(read_status(job), indent=2, sort_keys=True))
    return 0


def cmd_result(args: argparse.Namespace) -> int:
    job = Path(args.job) if args.job else latest_job(args.role)
    if job is None:
        print(f"no job for role={args.role}", file=sys.stderr)
        return 1
    sys.stdout.write((job / "output.txt").read_text(encoding="utf-8", errors="replace"))
    return 0


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="cmd", required=True)
    run = sub.add_parser("run")
    run.add_argument("--role", required=True)
    run.add_argument("--prompt")
    run.add_argument("--prompt-file")
    run.add_argument("--system", default="")
    run.add_argument("--session-id", default="")
    run.add_argument("--last", action="store_true")
    run.add_argument("--model", default="")
    run.add_argument("--timeout", type=float, default=0.0)
    run.set_defaults(fn=cmd_run)

    status = sub.add_parser("status")
    status.add_argument("--role", required=True)
    status.add_argument("--job")
    status.set_defaults(fn=cmd_status)

    result = sub.add_parser("result")
    result.add_argument("--role", required=True)
    result.add_argument("--job")
    result.set_defaults(fn=cmd_result)
    args = parser.parse_args(argv)
    return args.fn(args)


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
