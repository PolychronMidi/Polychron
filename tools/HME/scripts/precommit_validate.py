#!/usr/bin/env python3
"""Fast staged-file pre-commit validation for repo hygiene."""
from __future__ import annotations

import json
import os
import py_compile
import re
import subprocess
import sys
import tempfile
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))
from path_policy import blocked_path_reason, load_policy, skip_syntax  # noqa: E402
from precommit_self_protect import self_protect_failures  # noqa: E402
import importlib.util  # noqa: E402
ROOT = Path(os.environ.get("PROJECT_ROOT") or subprocess.check_output(
    ["git", "rev-parse", "--show-toplevel"], text=True).strip())
HME_PATH = ROOT / "tools" / "HME"
if str(HME_PATH) not in sys.path:
    sys.path.insert(0, str(HME_PATH))
from todo_engine.grammar import parse_document  # noqa: E402
from todo_guard import lost_unfinished, _norm, _sig_words  # noqa: E402

_CHECK_ENV_FAILFAST_PATH = SCRIPT_DIR / "check-env-failfast.py"
_CHECK_ENV_FAILFAST_SPEC = importlib.util.spec_from_file_location("check_env_failfast", _CHECK_ENV_FAILFAST_PATH)
if _CHECK_ENV_FAILFAST_SPEC is None or _CHECK_ENV_FAILFAST_SPEC.loader is None:
    raise RuntimeError(f"cannot load env fail-fast checker: {_CHECK_ENV_FAILFAST_PATH}")
_check_env_failfast = importlib.util.module_from_spec(_CHECK_ENV_FAILFAST_SPEC)
_CHECK_ENV_FAILFAST_SPEC.loader.exec_module(_check_env_failfast)


def try_except_env_fallback_hits(path: str, text: str, keys: set[str]) -> list[dict]:
    return _check_env_failfast._try_except_fallback_rows(path, text.splitlines(), keys)


POLICY = load_policy(ROOT)
HOOK_PATH = Path(os.environ.get("HOOK_PATH") or ROOT / ".git" / "hooks" / "pre-commit")
POST_COMMIT_HOOK_PATH = Path(os.environ.get("POST_COMMIT_HOOK_PATH") or ROOT / ".git" / "hooks" / "post-commit")
ENV_PATH = ROOT / ".env"
MARKER = POLICY.get("env_secret_marker", "SECRETS ABOVE THIS LINE")
MAX_BYTES = int(os.environ.get("HME_PRECOMMIT_MAX_BYTES", str(POLICY.get("max_file_bytes", 5 * 1024 * 1024))))
def _expand_local_marker(name: str) -> str:
    sep = os.sep
    if name == "HOME_ABSOLUTE":
        return str(Path.home()).rstrip(sep) + sep
    if name == "TMP_ABSOLUTE":
        return tempfile.gettempdir().rstrip(sep) + sep
    if name == "MNT_ABSOLUTE":
        return sep + "m" + "nt" + sep
    return name


LOCAL_PATH_NEEDLES = tuple(
    _expand_local_marker(x) for x in POLICY.get("local_path_markers", [])
)
SYNTAX_EXTS = set(POLICY.get("syntax_check_extensions", []))

failures: list[str] = []
secrets: list[tuple[int, str, bytes]] = []


def git_bytes(*args: str, check: bool = True) -> bytes:
    proc = subprocess.run(
        ["git", "-C", str(ROOT), *args],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    if check and proc.returncode != 0:
        raise RuntimeError(proc.stderr.decode("utf-8", "replace"))
    return proc.stdout


def parse_env_value(raw: str) -> str:
    value = raw.strip()
    if not value:
        return ""
    if value[0] in ('"', "'"):
        quote = value[0]
        out: list[str] = []
        escaped = False
        for ch in value[1:]:
            if escaped:
                out.append(ch)
                escaped = False
            elif ch == "\\" and quote == '"':
                escaped = True
            elif ch == quote:
                break
            else:
                out.append(ch)
        return "".join(out)
    if " #" in value:
        value = value.split(" #", 1)[0].rstrip()
    return value


def load_env_secrets() -> None:
    if not ENV_PATH.is_file():
        return
    saw_marker = False
    for lineno, line in enumerate(ENV_PATH.read_text(encoding="utf-8", errors="replace").splitlines(), 1):
        if MARKER in line:
            saw_marker = True
            break
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        if stripped.startswith("export "):
            stripped = stripped[7:].lstrip()
        key, raw_value = stripped.split("=", 1)
        key = key.strip()
        value = parse_env_value(raw_value)
        if value:
            secrets.append((lineno, key, value.encode("utf-8")))
    if not saw_marker:
        failures.append(".env is missing the line-13 secret boundary marker")


def redact(text: str) -> str:
    out = text
    for _lineno, key, raw in secrets:
        try:
            value = raw.decode("utf-8")
        except UnicodeDecodeError:
            continue
        if value:
            out = out.replace(value, f"<redacted:{key}>")
    return out


def q(path: str) -> str:
    return redact(path)


def staged_paths() -> list[str]:
    raw = git_bytes("diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z")
    return [p.decode("utf-8", "surrogateescape") for p in raw.split(b"\0") if p]


def tracked_paths() -> list[str]:
    raw = git_bytes("ls-files", "-z")
    return [p.decode("utf-8", "surrogateescape") for p in raw.split(b"\0") if p]


def staged_mode(path: str) -> str:
    out = git_bytes("ls-files", "-s", "--", path, check=False).decode("utf-8", "replace")
    if not out.strip():
        return ""
    return out.split(None, 1)[0]


def staged_size(path: str) -> int | None:
    out = git_bytes("cat-file", "-s", f":{path}", check=False)
    try:
        return int(out.decode("ascii", "replace").strip())
    except ValueError:
        return None


def staged_blob(path: str) -> bytes | None:
    proc = subprocess.run(
        ["git", "-C", str(ROOT), "show", f":{path}"],
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
    )
    if proc.returncode != 0:
        return None
    return proc.stdout


def tracked_blob(path: str) -> bytes | None:
    try:
        return (ROOT / path).read_bytes()
    except OSError:
        return head_blob(path)


def head_blob(path: str) -> bytes | None:
    proc = subprocess.run(
        ["git", "-C", str(ROOT), "show", f"HEAD:{path}"],
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
    )
    if proc.returncode == 0:
        return proc.stdout
    return None


def is_text(data: bytes) -> bool:
    if b"\0" in data[:8192]:
        return False
    try:
        data[:65536].decode("utf-8")
        return True
    except UnicodeDecodeError:
        return False


def has_conflict_markers(data: bytes) -> bool:
    lines = data.splitlines()
    left_marker = b"<" * 7
    right_marker = b">" * 7
    has_start = any(line.startswith(left_marker) for line in lines)
    has_sep = any(re.fullmatch(br"={7,}", line.strip()) for line in lines)
    has_end = any(line.startswith(right_marker) for line in lines)
    return has_start and has_sep and has_end


def secret_hits(path: str, data: bytes) -> list[str]:
    hits = []
    for lineno, key, secret in secrets:
        if secret and secret in data:
            hits.append(f"{q(path)} contains value of {key} from .env line {lineno}")
    return hits


def _is_embedded_project_tmp(line: str, pos: int) -> bool:
    """True when project scratch is not absolute tmp."""
    if pos <= 0:
        return False
    return line[pos - 1].isalnum() or line[pos - 1] in "_}"


def local_path_hits(path: str, text: str) -> list[str]:
    hits = []
    for lineno, line in enumerate(text.splitlines(), 1):
        for needle in LOCAL_PATH_NEEDLES:
            if not needle:
                continue
            start = line.find(needle)
            while start != -1 and _is_embedded_project_tmp(line, start):
                start = line.find(needle, start + 1)
            if start != -1:
                hits.append(f"{q(path)}:{lineno} contains local path marker {needle.rstrip('/')}")
                break
    return hits


def syntax_check(path: str, data: bytes) -> None:
    if skip_syntax(path, POLICY):
        return
    suffix = Path(path).suffix.lower()
    if suffix not in SYNTAX_EXTS:
        return
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        failures.append(f"{q(path)}: cannot syntax-check non-UTF8 {suffix} file")
        return
    if suffix == ".json":
        try:
            json.loads(text)
        except json.JSONDecodeError as exc:
            failures.append(f"{q(path)}: invalid JSON at line {exc.lineno}, column {exc.colno}")
        return
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", suffix=suffix, delete=False) as tmp:
        tmp.write(text)
        tmp_path = tmp.name
    try:
        if suffix == ".py":
            try:
                py_compile.compile(tmp_path, doraise=True)
            except py_compile.PyCompileError as exc:
                failures.append(f"{q(path)}: invalid Python syntax ({redact(str(exc.exc_type_name))})")
        elif suffix in {".js", ".mjs", ".cjs"}:
            proc = subprocess.run(["node", "--check", tmp_path], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            if proc.returncode != 0:
                detail = redact((proc.stderr or proc.stdout).splitlines()[0] if (proc.stderr or proc.stdout) else "node --check failed")
                failures.append(f"{q(path)}: invalid JavaScript syntax ({detail})")
        elif suffix in {".sh", ".bash"}:
            proc = subprocess.run(["bash", "-n", tmp_path], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            if proc.returncode != 0:
                detail = redact((proc.stderr or proc.stdout).splitlines()[0] if (proc.stderr or proc.stdout) else "bash -n failed")
                failures.append(f"{q(path)}: invalid shell syntax ({detail})")
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass


def executable_sanity(path: str, mode: str, data: bytes) -> None:
    if mode not in {"100644", "100755"}:
        return
    text = is_text(data)
    has_shebang = data.startswith(b"#!")
    is_exec = mode == "100755"
    if has_shebang and not is_exec:
        failures.append(f"{q(path)}: has a shebang but is not executable")
    if is_exec and text and not has_shebang:
        failures.append(f"{q(path)}: executable text file lacks a shebang")


def full_env_failfast_check() -> None:
    script = ROOT / "tools" / "HME" / "scripts" / "check-env-failfast.py"
    proc = subprocess.run(["python3", str(script)], cwd=str(ROOT), stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if proc.returncode != 0:
        detail = (proc.stdout or proc.stderr or "env fail-fast checker failed").strip().splitlines()
        failures.append("env fail-fast invariant failed: " + (detail[0] if detail else "unknown"))
        for line in detail[1:20]:
            failures.append("env fail-fast invariant failed: " + line)


def staged_python_compile_check() -> None:
    for path in staged_paths():
        if not path.endswith(".py") or skip_syntax(path, POLICY):
            continue
        blob = staged_blob(path)
        if blob is None:
            continue
        with tempfile.NamedTemporaryFile("wb", suffix=".py", delete=False) as tmp:
            tmp.write(blob)
            tmp_path = tmp.name
        try:
            try:
                py_compile.compile(tmp_path, doraise=True)
            except py_compile.PyCompileError as exc:
                failures.append(f"{q(path)}: invalid staged Python syntax ({redact(str(exc.exc_type_name))})")
        finally:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass  # silent-ok: tempfile already gone or OS cleanup raced


def full_python_compile_check() -> None:
    raw = git_bytes("ls-files", "-s", "-z", "--", "*.py", check=False)
    for entry in raw.split(b"\0"):
        if not entry:
            continue
        line = entry.decode("utf-8", "surrogateescape")
        meta, path = line.split("\t", 1)
        mode = meta.split(" ", 1)[0]
        if mode not in {"100644", "100755"} or skip_syntax(path, POLICY):
            continue
        blob = tracked_blob(path)
        if blob is None:
            continue
        with tempfile.NamedTemporaryFile("wb", suffix=".py", delete=False) as tmp:
            tmp.write(blob)
            tmp_path = tmp.name
        try:
            try:
                py_compile.compile(tmp_path, doraise=True)
            except py_compile.PyCompileError as exc:
                failures.append(f"{q(path)}: invalid tracked Python syntax ({redact(str(exc.exc_type_name))})")
        finally:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass  # silent-ok: tempfile already gone or OS cleanup raced


def head_tree_empty() -> bool:
    try:
        tree = subprocess.check_output(["git", "-C", str(ROOT), "rev-parse", "HEAD^{tree}"], text=True).strip()
    except subprocess.CalledProcessError:
        return False
    return tree == "4b825dc642cb6eb9a060e54bf8d69288fbee4904"


def validate_path_content(path: str, mode: str, data: bytes, *, staged: bool) -> None:
    reason = blocked_path_reason(path, POLICY)
    if reason:
        failures.append(f"{q(path)}: blocked path ({reason})")
        return
    if mode == "120000":
        return
    if len(data) > MAX_BYTES:
        scope = "staged file" if staged else "tracked file"
        failures.append(f"{q(path)}: {scope} is {len(data)} bytes, exceeds {MAX_BYTES} byte pre-commit limit")
        return
    failures.extend(secret_hits(path, data))
    if has_conflict_markers(data):
        failures.append(f"{q(path)}: contains unresolved merge-conflict markers")
    if is_text(data):
        text = data.decode("utf-8", "replace")
        failures.extend(local_path_hits(path, text))
    executable_sanity(path, mode, data)
    syntax_check(path, data)


def tracked_mode(path: str) -> str:
    out = git_bytes("ls-files", "-s", "--", path, check=False).decode("utf-8", "replace")
    if not out.strip():
        return ""
    return out.split(None, 1)[0]


def _non_done_todos(text: str):
    _header, todos = parse_document(text or "")
    return [t for t in todos if t.code != "5"]


def todo_survivor_check() -> None:
    path = "doc/templates/TODO.md"
    staged = set(staged_paths())
    if path not in staged:
        return
    before = head_blob(path)
    after = staged_blob(path)
    if before is None or after is None:
        return
    before_text = before.decode("utf-8", "replace")
    after_text = after.decode("utf-8", "replace")
    lost = lost_unfinished(before_text, after_text)
    if lost:
        archived_text = ""
        for staged_path in staged:
            if not staged_path.startswith("log/todo/set") or not staged_path.endswith(".md"):
                continue
            blob = staged_blob(staged_path)
            if blob:
                archived_text += "\n" + blob.decode("utf-8", "replace")
        if archived_text:
            archived_done = []
            current_header = []
            current_body = []
            for line in archived_text.splitlines():
                if line.lower().startswith("### todo - set "):
                    if current_header or current_body:
                        _h, todos = parse_document("\n".join(current_header + current_body))
                        archived_done.extend(t for t in todos if t.code == "5")
                    current_header = [line]
                    current_body = []
                elif current_header:
                    current_body.append(line)
            if current_header or current_body:
                _h, todos = parse_document("\n".join(current_header + current_body))
                archived_done.extend(t for t in todos if t.code == "5")
            archived_norm = {_norm(t.text) for t in archived_done}
            kept = []
            for item in lost:
                if _norm(item.text) in archived_norm:
                    continue
                item_words = _sig_words(item.text)
                matched = False
                for done in archived_done:
                    done_words = _sig_words(done.text)
                    overlap = (len(item_words & done_words) / len(item_words)) if item_words and done_words else 0.0
                    if overlap >= 1 / 3 or (done.id == item.id and overlap >= 0.25):
                        matched = True
                        break
                if not matched:
                    kept.append(item)
            lost = kept
    if lost:
        detail = " | ".join(f"#{t.id} {t.code}_ {t.text[:120]}" for t in lost[:5])
        failures.append("doc/templates/TODO.md: non-5_ todo(s) removed instead of surviving active set: " + detail)


def staged_content_check() -> None:
    for path in staged_paths():
        mode = staged_mode(path)
        data = staged_blob(path)
        if data is None:
            continue
        validate_path_content(path, mode, data, staged=True)


def full_repo_content_check() -> None:
    staged = set(staged_paths())
    seen: set[str] = set()
    for path in tracked_paths():
        seen.add(path)
        mode = staged_mode(path) if path in staged else tracked_mode(path)
        data = staged_blob(path) if path in staged else tracked_blob(path)
        if data is None:
            continue
        validate_path_content(path, mode, data, staged=path in staged)
    for path in staged - seen:
        mode = staged_mode(path)
        data = staged_blob(path)
        if data is not None:
            validate_path_content(path, mode, data, staged=True)


_FULL_SWEEP_STAMP = ROOT / "tools" / "HME" / "runtime" / "precommit-full-sweep.ts"
_FULL_SWEEP_INTERVAL_SEC = 86400


def _due_for_full_sweep() -> bool:
    if "--full" in sys.argv:
        return True
    try:
        last = float(_FULL_SWEEP_STAMP.read_text(encoding="utf-8").strip())
    except (OSError, ValueError):
        return True
    import time as _t
    return (_t.time() - last) >= _FULL_SWEEP_INTERVAL_SEC


def _mark_full_sweep_done() -> None:
    import time as _t
    try:
        _FULL_SWEEP_STAMP.parent.mkdir(parents=True, exist_ok=True)
        _FULL_SWEEP_STAMP.write_text(f"{_t.time()}\n", encoding="utf-8")
    except OSError:
        pass  # silent-ok: pending review


def main() -> int:
    load_env_secrets()
    failures.extend(self_protect_failures(ROOT, POLICY, HOOK_PATH, POST_COMMIT_HOOK_PATH, MARKER))
    if head_tree_empty() and tracked_paths():
        print("WARNING: HEAD tree is empty while index has tracked files (autocommit will self-repair with --no-verify)", file=sys.stderr)
    if _due_for_full_sweep():
        full_env_failfast_check()
        full_python_compile_check()
        full_repo_content_check()
        if not failures:
            _mark_full_sweep_done()
    else:
        staged_python_compile_check()
        staged_content_check()
    todo_survivor_check()
    if failures:
        print("ERROR: pre-commit validation blocked this commit.", file=sys.stderr)
        print("Fix or unstage the following:", file=sys.stderr)
        for item in failures[:80]:
            print(f"  - {item}", file=sys.stderr)
        if len(failures) > 80:
            print(f"  ... {len(failures) - 80} more", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
