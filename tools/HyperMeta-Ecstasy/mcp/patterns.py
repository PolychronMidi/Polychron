import re
import os
from pathlib import Path
from lang_registry import ext_to_lang, SUPPORTED_EXTENSIONS
from file_walker import walk_code_files


def _check_unbounded(content: str, file_path: str, language: str) -> list[dict]:
    results = []
    grow_patterns = [
        (r'\.push\(', ".push("),
        (r'\.add\(', ".add("),
        (r'\.set\(', ".set("),
        (r'\.insert\(', ".insert("),
    ]
    shrink_patterns = [r'\.clear\(', r'\.delete\(', r'\.remove\(', r'\.drain\(', r'\.pop\(', r'\.splice\(']

    lines = content.split("\n")
    for pat_str, label in grow_patterns:
        for i, line in enumerate(lines, 1):
            if re.search(pat_str, line):
                scope_start = max(0, i - 30)
                scope_end = min(len(lines), i + 30)
                scope = "\n".join(lines[scope_start:scope_end])
                has_shrink = any(re.search(sp, scope) for sp in shrink_patterns)
                if not has_shrink:
                    var_match = re.search(r'(\w+)' + re.escape(label), line)
                    var_name = var_match.group(1) if var_match else "?"
                    results.append({
                        "file": file_path, "line": i, "check": "unbounded_collection",
                        "severity": "warn",
                        "message": f"'{var_name}' grows via {label.strip('(')} without cleanup in nearby scope",
                    })
    return results


def _check_unsafe(content: str, file_path: str) -> list[dict]:
    results = []
    for m in re.finditer(r'\bunsafe\s*\{', content):
        line = content[:m.start()].count("\n") + 1
        results.append({
            "file": file_path, "line": line, "check": "unsafe_block",
            "severity": "info",
            "message": "unsafe block",
        })
    return results


def _check_todo_density(content: str, file_path: str) -> list[dict]:
    todos = re.findall(r'\b(TODO|FIXME|HACK)\b', content)
    if len(todos) > 5:
        return [{
            "file": file_path, "line": 0, "check": "todo_density",
            "severity": "info",
            "message": f"{len(todos)} TODO/FIXME/HACK annotations found",
        }]
    return []


_RESOURCE_TYPES_TS = {
    "WebGLTexture", "WebGLBuffer", "WebGLFramebuffer", "WebGLRenderbuffer",
    "WebGLProgram", "WebGLShader", "AudioBuffer", "AudioContext",
    "Worker", "GPUTexture", "GPUBuffer", "GPURenderPipeline",
    "Texture", "RenderTarget", "WebGLRenderTarget", "FramebufferTexture2D",
    "DataTexture", "CanvasTexture", "CubeTexture", "CompressedTexture",
}

_RESOURCE_TYPES_RUST = {
    "File", "TcpStream", "UdpSocket", "Mutex", "RwLock",
    "BufReader", "BufWriter",
}


def _check_missing_dispose(content: str, file_path: str, language: str) -> list[dict]:
    results = []

    if language in ("typescript", "javascript"):
        class_pat = re.compile(r'class\s+(\w+)[^{]*\{', re.MULTILINE)
        for m in class_pat.finditer(content):
            class_name = m.group(1)
            line = content[:m.start()].count("\n") + 1
            brace_start = m.end() - 1
            depth = 1
            i = brace_start + 1
            while i < len(content) and depth > 0:
                if content[i] == '{':
                    depth += 1
                elif content[i] == '}':
                    depth -= 1
                i += 1
            class_body = content[brace_start:i]

            has_resource = any(rt in class_body for rt in _RESOURCE_TYPES_TS)
            if not has_resource:
                continue
            has_dispose = bool(re.search(r'\b(dispose|destroy|cleanup|teardown)\s*\(', class_body))
            if not has_dispose:
                results.append({
                    "file": file_path, "line": line, "check": "missing_dispose",
                    "severity": "warn",
                    "message": f"class '{class_name}' has resource fields but no dispose/destroy method",
                })

    elif language == "rust":
        struct_pat = re.compile(r'struct\s+(\w+)', re.MULTILINE)
        for m in struct_pat.finditer(content):
            struct_name = m.group(1)
            line = content[:m.start()].count("\n") + 1
            has_resource = any(rt in content for rt in _RESOURCE_TYPES_RUST)
            if not has_resource:
                continue
            drop_pat = re.compile(rf'impl\s+Drop\s+for\s+{re.escape(struct_name)}')
            if not drop_pat.search(content):
                results.append({
                    "file": file_path, "line": line, "check": "missing_dispose",
                    "severity": "warn",
                    "message": f"struct '{struct_name}' may have resource fields but no Drop impl",
                })

    elif language == "python":
        class_pat = re.compile(r'^class\s+(\w+)', re.MULTILINE)
        for m in class_pat.finditer(content):
            class_name = m.group(1)
            line = content[:m.start()].count("\n") + 1
            has_resource = any(kw in content for kw in ("open(", "socket(", "connect(", "Thread(", "Process("))
            if not has_resource:
                continue
            has_cleanup = bool(re.search(r'def\s+(__del__|close|cleanup|dispose|shutdown)\s*\(', content))
            if not has_cleanup:
                results.append({
                    "file": file_path, "line": line, "check": "missing_dispose",
                    "severity": "warn",
                    "message": f"class '{class_name}' may use resources but has no cleanup method",
                })

    return results


def _check_large_function(content: str, file_path: str, language: str) -> list[dict]:
    from complexity import _extract_function_bodies
    results = []
    actual_lang = language
    actual_content = content

    if language == "vue":
        script_match = re.search(r'<script[^>]*>(.*?)</script>', content, re.DOTALL)
        if script_match:
            actual_content = script_match.group(1)
            actual_lang = "typescript"
        else:
            return []

    functions = _extract_function_bodies(actual_content, actual_lang)
    for name, line, body in functions:
        line_count = body.count("\n") + 1
        if line_count > 100:
            results.append({
                "file": file_path, "line": line, "check": "large_function",
                "severity": "warn",
                "message": f"function '{name}' is {line_count} lines long (>100)",
            })
    return results


def _check_deep_nesting(content: str, file_path: str, language: str) -> list[dict]:
    results = []
    lines = content.split("\n")

    if language in ("rust", "typescript", "javascript", "vue", "java", "kotlin", "scala", "csharp", "go", "php", "c", "cpp", "dart", "swift"):
        depth = 0
        for i, line in enumerate(lines, 1):
            for ch in line:
                if ch == '{':
                    depth += 1
                    if depth > 5:
                        results.append({
                            "file": file_path, "line": i, "check": "deep_nesting",
                            "severity": "warn",
                            "message": f"nesting depth {depth} exceeds 5",
                        })
                        break
                elif ch == '}':
                    depth -= 1

    elif language in ("python", "nim", "haskell"):
        for i, line in enumerate(lines, 1):
            if not line.strip():
                continue
            indent = len(line) - len(line.lstrip())
            depth = indent // 4
            if depth > 5:
                results.append({
                    "file": file_path, "line": i, "check": "deep_nesting",
                    "severity": "warn",
                    "message": f"indentation depth {depth} exceeds 5",
                })

    return results


_CONST_LINE_PAT_TS = re.compile(r'^\s*(?:export\s+)?(?:const|static|readonly)\s+', re.MULTILINE)
_CONST_LINE_PAT_RUST = re.compile(r'^\s*(?:pub\s+)?(?:const|static)\s+', re.MULTILINE)
_CONST_LINE_PAT_PY = re.compile(r'^[A-Z_][A-Z0-9_]*\s*=', re.MULTILINE)

_MAGIC_NUM_PAT = re.compile(r'(?<!\w)(\d+\.?\d*|\.\d+)(?!\w)')

_SAFE_NUMBERS = {"0", "1", "0.0", "1.0", "0.5", "2"}


def _check_magic_numbers(content: str, file_path: str, language: str) -> list[dict]:
    results = []
    lines = content.split("\n")
    reported_lines = set()

    for i, line in enumerate(lines, 1):
        stripped = line.strip()
        if not stripped or stripped.startswith("//") or stripped.startswith("#") or stripped.startswith("*"):
            continue

        if language in ("typescript", "javascript", "vue"):
            if _CONST_LINE_PAT_TS.match(line):
                continue
            if re.match(r'^\s*(?:import|from|export)\b', line):
                continue
        elif language == "rust":
            if _CONST_LINE_PAT_RUST.match(line):
                continue
            if re.match(r'^\s*(?:use|mod)\b', line):
                continue
        elif language == "python":
            if _CONST_LINE_PAT_PY.match(line):
                continue
            if re.match(r'^\s*(?:import|from)\b', line):
                continue

        for m in _MAGIC_NUM_PAT.finditer(stripped):
            num_str = m.group(1)
            if num_str in _SAFE_NUMBERS:
                continue
            try:
                val = float(num_str)
            except ValueError:
                continue
            if abs(val) <= 1:
                continue
            if i not in reported_lines:
                reported_lines.add(i)
                results.append({
                    "file": file_path, "line": i, "check": "magic_numbers",
                    "severity": "info",
                    "message": f"magic number {num_str} found",
                })

    return results


def _check_error_swallow(content: str, file_path: str, language: str) -> list[dict]:
    results = []

    if language in ("typescript", "javascript", "vue", "java", "kotlin", "scala", "csharp", "dart"):
        for m in re.finditer(r'\bcatch\s*\([^)]*\)\s*\{\s*\}', content):
            line = content[:m.start()].count("\n") + 1
            results.append({
                "file": file_path, "line": line, "check": "error_swallow",
                "severity": "error",
                "message": "empty catch block swallows error",
            })

    elif language == "rust":
        for m in re.finditer(r'\bcatch\s*\([^)]*\)\s*\{\s*\}', content):
            line = content[:m.start()].count("\n") + 1
            results.append({
                "file": file_path, "line": line, "check": "error_swallow",
                "severity": "error",
                "message": "empty catch block swallows error",
            })
        for m in re.finditer(r'(?:Err|None)\s*=>\s*\{\s*\}', content):
            line = content[:m.start()].count("\n") + 1
            results.append({
                "file": file_path, "line": line, "check": "error_swallow",
                "severity": "error",
                "message": "empty Err/None match arm swallows error",
            })
        for m in re.finditer(r'\.ok\(\)\s*;', content):
            line = content[:m.start()].count("\n") + 1
            results.append({
                "file": file_path, "line": line, "check": "error_swallow",
                "severity": "warn",
                "message": ".ok() silently discards error",
            })

    elif language == "python":
        for m in re.finditer(r'\bexcept[^:]*:\s*\n\s+pass\b', content):
            line = content[:m.start()].count("\n") + 1
            results.append({
                "file": file_path, "line": line, "check": "error_swallow",
                "severity": "error",
                "message": "bare except with pass swallows error",
            })

    elif language == "go":
        for m in re.finditer(r'if\s+err\s*!=\s*nil\s*\{\s*\}', content):
            line = content[:m.start()].count("\n") + 1
            results.append({
                "file": file_path, "line": line, "check": "error_swallow",
                "severity": "error",
                "message": "empty error check block",
            })

    return results


_CHECK_REGISTRY = {
    "unbounded_collection": lambda c, f, l: _check_unbounded(c, f, l),
    "unsafe_block": lambda c, f, l: _check_unsafe(c, f) if l == "rust" else [],
    "todo_density": lambda c, f, l: _check_todo_density(c, f),
    "missing_dispose": lambda c, f, l: _check_missing_dispose(c, f, l),
    "large_function": lambda c, f, l: _check_large_function(c, f, l),
    "deep_nesting": lambda c, f, l: _check_deep_nesting(c, f, l),
    "magic_numbers": lambda c, f, l: _check_magic_numbers(c, f, l),
    "error_swallow": lambda c, f, l: _check_error_swallow(c, f, l),
}


def detect_patterns(directory: str, checks: list[str] | None = None) -> list[dict]:
    active_checks = checks if checks else list(_CHECK_REGISTRY.keys())
    all_results = []

    for fpath in walk_code_files(directory):
        lang = ext_to_lang(fpath.suffix if fpath.suffix else fpath.name)
        if not lang or lang == "text":
            continue

        try:
            content = fpath.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            continue

        if lang == "vue":
            script_match = re.search(r'<script[^>]*>(.*?)</script>', content, re.DOTALL)
            check_content = script_match.group(1) if script_match else content
            check_lang = "typescript" if script_match else lang
        else:
            check_content = content
            check_lang = lang

        file_str = str(fpath)
        for check_name in active_checks:
            if check_name not in _CHECK_REGISTRY:
                continue
            findings = _CHECK_REGISTRY[check_name](check_content, file_str, check_lang)
            all_results.extend(findings)

    return all_results

