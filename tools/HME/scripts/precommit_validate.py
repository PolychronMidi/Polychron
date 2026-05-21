#!/usr/bin/env python3
"""Fast staged-file pre-commit validation for repo hygiene."""
from __future__ import annotations

import json
import os
import py_compile
import re
import stat
import subprocess
import sys
import tempfile
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))
from path_policy import blocked_path_reason, load_policy, skip_syntax  # noqa: E402

ROOT = Path(os.environ.get("PROJECT_ROOT") or subprocess.check_output(
    ["git", "rev-parse", "--show-toplevel"], text=True).strip())
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
LOCAL_PATH_ALLOW = POLICY.get("local_path_allow_token", "local-path-ok")
SYNTAX_EXTS = set(POLICY.get("syntax_check_extensions", []))
ENV_TEMPLATE = ROOT / POLICY.get("env_template", "doc/templates/.env.example")
ENV_FALLBACK_EXTS = {".js", ".mjs", ".cjs", ".ts", ".py", ".sh", ".bash", ".json"}

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
        if LOCAL_PATH_ALLOW in line:
            continue
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


def env_template_keys() -> set[str]:
    if not ENV_TEMPLATE.is_file():
        failures.append("env invariant failed: doc/templates/.env.example is missing")
        return set()
    if (ROOT / ".env.example").exists():
        failures.append("env invariant failed: .env.example must live at doc/templates/.env.example, not repo root")
    keys: set[str] = set()
    for line in ENV_TEMPLATE.read_text(encoding="utf-8", errors="replace").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key = stripped.split("=", 1)[0].strip()
        if key:
            keys.add(key)
    return keys


_ENV_FALLBACK_PATTERNS = [
    re.compile(r"process\.env\.([A-Z0-9_]+)\s*(?:\|\||\?\?)"),
    re.compile(r"process\.env\[['\"]([A-Z0-9_]+)['\"]\]\s*(?:\|\||\?\?)"),
    re.compile(r"os\.environ\.get\(\s*['\"]([A-Z0-9_]+)['\"]\s*,"),
    re.compile(r"os\.getenv\(\s*['\"]([A-Z0-9_]+)['\"]\s*,"),
    re.compile(r"\bgetenv\(\s*['\"]([A-Z0-9_]+)['\"]\s*,"),
    re.compile(r"\$\{([A-Z0-9_]+)(?::-|-)"),
]


def inline_env_fallback_hits(path: str, text: str, keys: set[str]) -> list[str]:
    if Path(path).suffix.lower() not in ENV_FALLBACK_EXTS:
        return []
    hits: list[str] = []
    for lineno, line in enumerate(text.splitlines(), 1):
        if "env-fallback-ok" in line:
            continue
        for pattern in _ENV_FALLBACK_PATTERNS:
            for match in pattern.finditer(line):
                key = match.group(1)
                if key in keys:
                    hits.append(
                        f"{q(path)}:{lineno} uses inline fallback for .env key {key}; "
                        "defaults belong in doc/templates/.env.example and runtime reads must fail fast"
                    )
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


def self_protect() -> None:
    canonical = ROOT / POLICY.get("canonical_precommit", "tools/HME/git-hooks/pre-commit")
    validator = ROOT / POLICY.get("precommit_validator", "tools/HME/scripts/precommit_validate.py")
    if not canonical.is_file():
        failures.append("pre-commit self-protection failed: canonical hook missing")
    if not validator.is_file():
        failures.append("pre-commit self-protection failed: validator missing")
    try:
        hook_text = HOOK_PATH.read_text(encoding="utf-8", errors="replace")
    except OSError as exc:
        failures.append(f"pre-commit self-protection failed: cannot read hook ({exc.__class__.__name__})")
        return
    required = [MARKER, "precommit_validate.py"]
    missing = [token for token in required if token not in hook_text]
    if missing:
        failures.append("pre-commit self-protection failed: hook lost guard token(s): " + ", ".join(missing))
    if canonical.is_file():
        try:
            canonical_text = canonical.read_text(encoding="utf-8", errors="replace")
            if hook_text != canonical_text:
                failures.append("pre-commit self-protection failed: installed hook differs from canonical tools/HME/git-hooks/pre-commit")
        except OSError:
            pass
    try:
        mode = HOOK_PATH.stat().st_mode
        if not (mode & stat.S_IXUSR):
            failures.append("pre-commit self-protection failed: hook is not executable")
    except OSError:
        pass


def full_env_failfast_check() -> None:
    script = ROOT / "tools" / "HME" / "scripts" / "check-env-failfast.py"
    proc = subprocess.run(["python3", str(script)], cwd=str(ROOT), stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if proc.returncode != 0:
        detail = (proc.stdout or proc.stderr or "env fail-fast checker failed").strip().splitlines()
        failures.append("env fail-fast invariant failed: " + (detail[0] if detail else "unknown"))
        for line in detail[1:20]:
            failures.append("env fail-fast invariant failed: " + line)


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
                failures.append(f"{q(path)}: invalid tracked Python syntax ({redact(str(exc.exc_type_name))})")
        finally:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass  # silent-ok: tempfile already gone or OS cleanup raced


def main() -> int:
    load_env_secrets()
    self_protect()
    full_env_failfast_check()
    full_python_compile_check()
    declared_env_keys = env_template_keys()
    for path in staged_paths():
        reason = blocked_path_reason(path, POLICY)
        if reason:
            failures.append(f"{q(path)}: blocked path ({reason})")
            continue
        size = staged_size(path)
        if size is not None and size > MAX_BYTES:
            failures.append(f"{q(path)}: staged file is {size} bytes, exceeds {MAX_BYTES} byte pre-commit limit")
            continue
        data = staged_blob(path)
        if data is None:
            continue
        failures.extend(secret_hits(path, data))
        if has_conflict_markers(data):
            failures.append(f"{q(path)}: contains unresolved merge-conflict markers")
        if is_text(data):
            text = data.decode("utf-8", "replace")
            failures.extend(local_path_hits(path, text))
            failures.extend(inline_env_fallback_hits(path, text, declared_env_keys))
        executable_sanity(path, staged_mode(path), data)
        syntax_check(path, data)
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
