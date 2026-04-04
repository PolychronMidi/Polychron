import os
import re
import subprocess
import logging
from pathlib import Path
from typing import Optional
from collections import defaultdict

from lang_registry import ext_to_lang, SUPPORTED_EXTENSIONS
from file_walker import walk_code_files, get_ignore_dirs, get_lib_abs_paths

logger = logging.getLogger(__name__)

IMPORT_PATTERNS = {
    "typescript": [
        re.compile(r'''(?:import|export)\s+.*?\s+from\s+['"]([^'"]+)['"]'''),
        re.compile(r'''(?:import|export)\s*\(\s*['"]([^'"]+)['"]\s*\)'''),
        re.compile(r'''require\s*\(\s*['"]([^'"]+)['"]\s*\)'''),
    ],
    "javascript": [
        re.compile(r'''(?:import|export)\s+.*?\s+from\s+['"]([^'"]+)['"]'''),
        re.compile(r'''require\s*\(\s*['"]([^'"]+)['"]\s*\)'''),
    ],
    "rust": [
        re.compile(r'''use\s+((?:crate|super|self)(?:::\w+)+)'''),
        re.compile(r'''mod\s+(\w+)\s*;'''),
    ],
    "python": [
        re.compile(r'''^\s*(?:from\s+(\S+)\s+)?import\s+(\S+)''', re.MULTILINE),
    ],
    "vue": [
        re.compile(r'''(?:import|export)\s+.*?\s+from\s+['"]([^'"]+)['"]'''),
    ],
    "java": [
        re.compile(r'''^\s*import\s+(?:static\s+)?([\w.]+)\s*;''', re.MULTILINE),
    ],
    "kotlin": [
        re.compile(r'''^\s*import\s+([\w.]+)''', re.MULTILINE),
    ],
    "scala": [
        re.compile(r'''^\s*import\s+([\w.{},\s]+)''', re.MULTILINE),
    ],
    "go": [
        re.compile(r'''^\s*import\s+"([^"]+)"''', re.MULTILINE),
        re.compile(r'''^\s*"([^"]+)"''', re.MULTILINE),
    ],
    "ruby": [
        re.compile(r'''^\s*require\s+['"]([^'"]+)['"]''', re.MULTILINE),
        re.compile(r'''^\s*require_relative\s+['"]([^'"]+)['"]''', re.MULTILINE),
    ],
    "c": [
        re.compile(r'''^\s*#include\s*[<"]([^>"]+)[>"]''', re.MULTILINE),
    ],
    "cpp": [
        re.compile(r'''^\s*#include\s*[<"]([^>"]+)[>"]''', re.MULTILINE),
    ],
    "csharp": [
        re.compile(r'''^\s*using\s+([\w.]+)\s*;''', re.MULTILINE),
    ],
    "php": [
        re.compile(r'''^\s*use\s+([\w\\]+)\s*;''', re.MULTILINE),
        re.compile(r'''^\s*(?:require|include)(?:_once)?\s+['"]([^'"]+)['"]''', re.MULTILINE),
    ],
    "dart": [
        re.compile(r'''^\s*import\s+['"]([^'"]+)['"]''', re.MULTILINE),
    ],
    "swift": [
        re.compile(r'''^\s*import\s+(\w+)''', re.MULTILINE),
    ],
    "elixir": [
        re.compile(r'''^\s*(?:import|alias|use|require)\s+([\w.]+)''', re.MULTILINE),
    ],
    "haskell": [
        re.compile(r'''^\s*import\s+(?:qualified\s+)?([\w.]+)''', re.MULTILINE),
    ],
    "ocaml": [
        re.compile(r'''^\s*open\s+(\w+)''', re.MULTILINE),
    ],
    "erlang": [
        re.compile(r'''^\s*-include\(\s*"([^"]+)"\s*\)''', re.MULTILINE),
    ],
    "julia": [
        re.compile(r'''^\s*(?:using|import)\s+([\w.]+)''', re.MULTILINE),
    ],
    "perl": [
        re.compile(r'''^\s*use\s+([\w:]+)''', re.MULTILINE),
        re.compile(r'''^\s*require\s+['"]?([^'"\s;]+)''', re.MULTILINE),
    ],
    "lua": [
        re.compile(r'''^\s*(?:local\s+\w+\s*=\s*)?require\s*\(\s*['"]([^'"]+)['"]''', re.MULTILINE),
    ],
    "zig": [
        re.compile(r'''@import\s*\(\s*"([^"]+)"\s*\)'''),
    ],
    "nim": [
        re.compile(r'''^\s*import\s+([\w/]+)''', re.MULTILINE),
        re.compile(r'''^\s*from\s+([\w/]+)\s+import''', re.MULTILINE),
    ],
    "proto": [
        re.compile(r'''^\s*import\s+"([^"]+)"''', re.MULTILINE),
    ],
}

ANNOTATION_PATTERN = re.compile(
    r'(?://|#|/\*\*?)\s*(TODO|FIXME|HACK|XXX|BUG|WARN|NOTE|PERF|SAFETY)\b[:\s]*(.*?)(?:\*/)?$',
    re.MULTILINE | re.IGNORECASE,
)


def _resolve_import(import_path: str, source_file: Path, project_root: str, lang: str) -> Optional[str]:
    root = Path(project_root)

    if lang in ("typescript", "javascript", "vue"):
        if import_path.startswith("."):
            base = source_file.parent / import_path
            for suffix in [".ts", ".tsx", ".js", ".jsx", ".vue", "/index.ts", "/index.js"]:
                candidate = base.parent / (base.name + suffix)
                if candidate.exists():
                    return str(candidate)
            if base.is_dir():
                for idx in ["index.ts", "index.js", "index.tsx"]:
                    candidate = base / idx
                    if candidate.exists():
                        return str(candidate)
        return None

    if lang == "rust":
        parts = import_path.split("::")
        if parts[0] == "crate":
            parts = parts[1:]
        elif parts[0] in ("super", "self"):
            return None
        src_dir = None
        for p in source_file.parents:
            if (p / "Cargo.toml").exists():
                src_dir = p / "src"
                break
        if src_dir:
            mod_path = src_dir
            for part in parts[:2]:
                candidate_file = mod_path / f"{part}.rs"
                candidate_dir = mod_path / part
                if candidate_file.exists():
                    return str(candidate_file)
                elif candidate_dir.is_dir():
                    mod_path = candidate_dir
                    if (mod_path / "mod.rs").exists():
                        return str(mod_path / "mod.rs")
        return None

    if lang == "python":
        if import_path and not import_path.startswith("."):
            parts = import_path.split(".")
            candidate = root
            for part in parts:
                candidate = candidate / part
            for suffix in [".py", "/__init__.py"]:
                check = Path(str(candidate) + suffix)
                if check.exists():
                    return str(check)
        return None

    if lang in ("c", "cpp"):
        if not import_path.startswith("/"):
            candidate = source_file.parent / import_path
            if candidate.exists():
                return str(candidate)
        return None

    if lang == "go":
        return None

    if lang == "ruby":
        if import_path and not import_path.startswith("/"):
            candidate = source_file.parent / (import_path + ".rb")
            if candidate.exists():
                return str(candidate)
        return None

    return None


def get_dependency_graph(file_path: str, project_root: str) -> dict:
    target = Path(file_path)
    if not target.exists():
        return {"error": f"File not found: {file_path}"}

    lang = ext_to_lang(target.suffix if target.suffix else target.name)
    if not lang or lang == "text":
        return {"error": f"Unsupported language: {target.suffix}"}

    imports_from = []
    try:
        content = target.read_text(encoding="utf-8", errors="ignore")
        patterns = IMPORT_PATTERNS.get(lang, [])
        for pat in patterns:
            for match in pat.finditer(content):
                raw = match.group(1) or (match.group(2) if match.lastindex >= 2 else None)
                if raw:
                    resolved = _resolve_import(raw, target, project_root, lang)
                    imports_from.append({"raw": raw, "resolved": resolved})
    except Exception as e:
        logger.error(f"Failed to parse imports: {e}")

    imported_by = []
    target_str = str(target)
    for f in walk_code_files(project_root):
        if f == target:
            continue
        f_lang = ext_to_lang(f.suffix if f.suffix else f.name)
        if not f_lang or f_lang == "text":
            continue
        try:
            f_content = f.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            continue
        for pat in IMPORT_PATTERNS.get(f_lang, []):
            for match in pat.finditer(f_content):
                raw = match.group(1) or (match.group(2) if match.lastindex >= 2 else None)
                if raw:
                    resolved = _resolve_import(raw, f, project_root, f_lang)
                    if resolved and os.path.normpath(resolved) == os.path.normpath(target_str):
                        imported_by.append(str(f))
                        break

    return {
        "file": file_path,
        "imports": imports_from,
        "imported_by": imported_by,
    }


def find_orphan_files(project_root: str) -> dict:
    files = list(walk_code_files(project_root))
    all_resolved = set()

    for f in files:
        lang = ext_to_lang(f.suffix if f.suffix else f.name)
        if not lang or lang == "text":
            continue
        try:
            content = f.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            continue
        for pat in IMPORT_PATTERNS.get(lang, []):
            for match in pat.finditer(content):
                raw = match.group(1) or (match.group(2) if match.lastindex >= 2 else None)
                if raw:
                    resolved = _resolve_import(raw, f, project_root, lang)
                    if resolved:
                        all_resolved.add(os.path.normpath(resolved))

    entry_patterns = [
        "main.ts", "main.rs", "lib.rs", "mod.rs", "index.ts", "index.js",
        "App.vue", "main.py", "__init__.py",
        "Main.java", "Application.java", "main.go", "Program.cs",
        "main.kt", "Main.kt", "main.rb", "main.lua", "main.jl",
        "Makefile", "Dockerfile",
    ]

    orphans = []
    for f in files:
        norm = os.path.normpath(str(f))
        if norm in all_resolved:
            continue
        if f.name in entry_patterns:
            continue
        orphans.append(str(f))

    return {
        "total_files": len(files),
        "orphan_count": len(orphans),
        "orphans": orphans,
    }


def scan_annotations(project_root: str, annotation_type: str = "") -> list[dict]:
    results = []
    type_filter = annotation_type.upper() if annotation_type else None

    for f in walk_code_files(project_root):
        try:
            content = f.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            continue
        for match in ANNOTATION_PATTERN.finditer(content):
            tag = match.group(1).upper()
            if type_filter and tag != type_filter:
                continue
            text = match.group(2).strip()
            line_num = content[:match.start()].count("\n") + 1
            results.append({
                "file": str(f),
                "line": line_num,
                "type": tag,
                "text": text,
            })

    results.sort(key=lambda x: (x["type"], x["file"], x["line"]))
    return results


def find_similar_code(query_code: str, engine, top_k: int = 10) -> list[dict]:
    return engine.search(query_code, top_k=top_k)


def get_recent_changes(project_root: str, count: int = 20) -> dict:
    try:
        log_result = subprocess.run(
            ["git", "log", f"-{count}", "--pretty=format:%h|%an|%ar|%s", "--stat"],
            cwd=project_root,
            capture_output=True, text=True, timeout=10,
        )
        if log_result.returncode != 0:
            return {"error": f"git log failed: {log_result.stderr.strip()}"}

        diff_result = subprocess.run(
            ["git", "diff", "--stat", "HEAD"],
            cwd=project_root,
            capture_output=True, text=True, timeout=10,
        )

        freq = defaultdict(int)
        freq_result = subprocess.run(
            ["git", "log", f"-{count}", "--pretty=format:", "--name-only"],
            cwd=project_root,
            capture_output=True, text=True, timeout=10,
        )
        if freq_result.returncode == 0:
            for line in freq_result.stdout.strip().split("\n"):
                line = line.strip()
                if line:
                    freq[line] += 1

        hot_files = sorted(freq.items(), key=lambda x: -x[1])[:15]

        return {
            "log": log_result.stdout.strip(),
            "uncommitted": diff_result.stdout.strip() if diff_result.returncode == 0 else "",
            "hot_files": [{"file": f, "changes": c} for f, c in hot_files],
        }
    except FileNotFoundError:
        return {"error": "git not found"}
    except subprocess.TimeoutExpired:
        return {"error": "git command timed out"}


def get_project_summary(project_root: str, engine) -> dict:
    status = engine.get_status()
    kb_status = engine.get_knowledge_status()

    lang_stats = {}
    if engine.table is not None:
        try:
            rows = engine.table.to_arrow()
            langs = rows.column("language").to_pylist()
            for l in langs:
                lang_stats[l] = lang_stats.get(l, 0) + 1
        except Exception:
            pass

    recent_kb = []
    if engine.knowledge_table is not None:
        try:
            kb_rows = engine.knowledge_table.to_arrow().to_pylist()
            kb_rows.sort(key=lambda r: r.get("timestamp", 0), reverse=True)
            for r in kb_rows[:10]:
                recent_kb.append({
                    "title": r["title"],
                    "category": r["category"],
                    "tags": r["tags"],
                })
        except Exception:
            pass

    changes = get_recent_changes(project_root, count=10)

    return {
        "project_root": project_root,
        "index": status,
        "knowledge": kb_status,
        "language_distribution": lang_stats,
        "recent_knowledge": recent_kb,
        "recent_git": changes,
    }


def analyze_diff(project_root: str, ref: str = "") -> dict:
    from symbols import extract_symbols

    try:
        cmd = ["git", "diff", "--unified=0", "--no-color"]
        if ref:
            cmd.insert(2, ref)
        else:
            cmd.insert(2, "HEAD")
        r = subprocess.run(cmd, cwd=project_root, capture_output=True, text=True, timeout=15)
        if r.returncode != 0:
            return {"error": f"git diff failed: {r.stderr.strip()}"}
    except subprocess.TimeoutExpired:
        return {"error": "git diff timed out"}
    except FileNotFoundError:
        return {"error": "git not found"}

    diff_text = r.stdout
    hunk_re = re.compile(r'^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@', re.MULTILINE)
    file_re = re.compile(r'^diff --git a/(.*?) b/(.*?)$', re.MULTILINE)

    changed_files = []
    total_ins = 0
    total_del = 0

    file_splits = list(file_re.finditer(diff_text))
    for idx, fm in enumerate(file_splits):
        fpath = fm.group(2)
        start = fm.end()
        end = file_splits[idx + 1].start() if idx + 1 < len(file_splits) else len(diff_text)
        chunk = diff_text[start:end]

        ins = sum(1 for line in chunk.split("\n") if line.startswith("+") and not line.startswith("+++"))
        dels = sum(1 for line in chunk.split("\n") if line.startswith("-") and not line.startswith("---"))
        total_ins += ins
        total_del += dels

        hunk_ranges = []
        for hm in hunk_re.finditer(chunk):
            new_start = int(hm.group(3))
            new_count = int(hm.group(4)) if hm.group(4) else 1
            old_start = int(hm.group(1))
            old_count = int(hm.group(2)) if hm.group(2) else 1
            hunk_ranges.append((old_start, old_start + old_count, new_start, new_start + new_count))

        affected_symbols = []
        full_path = os.path.join(project_root, fpath)
        if os.path.isfile(full_path):
            fp = Path(full_path)
            file_lang = ext_to_lang(fp.suffix if fp.suffix else fp.name)
            if file_lang and file_lang != "text":
                try:
                    symbols = extract_symbols(full_path)
                    for sym in symbols:
                        sym_line = sym.get("line", 0)
                        end_line = sym.get("end_line", sym_line + 20)
                        for _, _, ns, ne in hunk_ranges:
                            if ns <= end_line and ne >= sym_line:
                                affected_symbols.append({
                                    "name": sym["name"],
                                    "kind": sym.get("kind", ""),
                                    "line": sym_line,
                                })
                                break
                except Exception:
                    pass

        changed_files.append({
            "file": fpath,
            "insertions": ins,
            "deletions": dels,
            "affected_symbols": affected_symbols,
        })

    impact = set()
    changed_paths = set()
    for cf in changed_files:
        changed_paths.add(os.path.normpath(os.path.join(project_root, cf["file"])))

    for f in walk_code_files(project_root):
        f_norm = os.path.normpath(str(f))
        if f_norm in changed_paths:
            continue
        lang = ext_to_lang(f.suffix if f.suffix else f.name)
        if not lang or lang == "text":
            continue
        try:
            content = f.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            continue
        for pat in IMPORT_PATTERNS.get(lang, []):
            for match in pat.finditer(content):
                raw = match.group(1) or (match.group(2) if match.lastindex >= 2 else None)
                if raw:
                    resolved = _resolve_import(raw, f, project_root, lang)
                    if resolved and os.path.normpath(resolved) in changed_paths:
                        impact.add(str(f))
                        break

    return {
        "ref": ref or "HEAD (working tree)",
        "files_changed": len(changed_files),
        "insertions": total_ins,
        "deletions": total_del,
        "changed_files": changed_files,
        "impact": sorted(impact),
    }


def _snake_to_camel(name: str) -> str:
    parts = name.split("_")
    return parts[0] + "".join(p.capitalize() for p in parts[1:])


def trace_cross_language(symbol_name: str, project_root: str) -> dict:
    camel_name = _snake_to_camel(symbol_name)

    rust_def = None
    fn_re = re.compile(rf'^\s*pub\s+fn\s+{re.escape(symbol_name)}\s*\(', re.MULTILINE)
    for fpath in walk_code_files(project_root, lang_filter="rust"):
        try:
            content = fpath.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            continue
        m = fn_re.search(content)
        if m:
            line_num = content[:m.start()].count("\n") + 1
            before = content[max(0, m.start() - 200):m.start()]
            is_wasm = "#[wasm_bindgen]" in before or "#[wasm_bindgen(" in before
            rust_def = {
                "file": os.path.relpath(str(fpath), project_root),
                "line": line_num,
                "is_wasm_export": is_wasm,
            }
            break

    bridge_refs = []
    ts_callers = []
    ts_exts = {".ts", ".tsx", ".js"}
    for fpath in walk_code_files(project_root, extensions=ts_exts):
        try:
            content = fpath.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            continue
        fname = fpath.name
        is_bridge = "bridge" in fname.lower() or "wasm" in fname.lower()
        for search_name in {symbol_name, camel_name}:
            pat = re.compile(rf'\b{re.escape(search_name)}\b')
            for m_ts in pat.finditer(content):
                line_num = content[:m_ts.start()].count("\n") + 1
                line_text = content.split("\n")[line_num - 1].strip()
                entry = {
                    "file": os.path.relpath(str(fpath), project_root),
                    "line": line_num,
                    "text": line_text[:200],
                }
                if is_bridge:
                    bridge_refs.append(entry)
                else:
                    ts_callers.append(entry)
                break

    chain = []
    if rust_def:
        wasm_tag = " [wasm_bindgen]" if rust_def["is_wasm_export"] else ""
        chain.append(f"rust:{rust_def['file']}:{rust_def['line']} fn {symbol_name}{wasm_tag}")
    for br in bridge_refs:
        chain.append(f"bridge:{br['file']}:{br['line']}")
    for tc in ts_callers:
        chain.append(f"caller:{tc['file']}:{tc['line']}")

    return {
        "symbol": symbol_name,
        "rust_definition": rust_def,
        "wasm_bridge": bridge_refs,
        "ts_callers": ts_callers,
        "chain": chain,
    }


def diff_configs(project_root: str) -> dict:
    config_patterns = [
        "Cargo.toml", "package.json", "tsconfig.json",
        "tsconfig.*.json", ".eslintrc*", "vite.config.*", "wasm-pack.toml",
        "pom.xml", "build.gradle", "build.sbt", "go.mod",
    ]

    ignore_dirs = get_ignore_dirs()
    lib_abs = get_lib_abs_paths()
    config_files = []
    for pattern in config_patterns:
        for fpath in Path(project_root).rglob(pattern):
            fpath_norm = os.path.normpath(str(fpath))
            rel = os.path.relpath(str(fpath), project_root)
            skip = False
            for ig in ignore_dirs:
                if ig in rel.split(os.sep):
                    skip = True
                    break
            if not skip:
                for la in lib_abs:
                    if fpath_norm == la or fpath_norm.startswith(la + os.sep):
                        skip = True
                        break
            if not skip:
                config_files.append(str(fpath))

    dep_add_re = re.compile(r'^\+\s*"?(\S+?)"?\s*[:=]')
    dep_del_re = re.compile(r'^-\s*"?(\S+?)"?\s*[:=]')

    results = []
    for cf in sorted(set(config_files)):
        rel_path = os.path.relpath(cf, project_root)
        try:
            r = subprocess.run(
                ["git", "diff", "HEAD", "--", rel_path],
                cwd=project_root, capture_output=True, text=True, timeout=15,
            )
        except (subprocess.TimeoutExpired, FileNotFoundError):
            continue

        has_changes = bool(r.stdout.strip())
        added_deps = []
        removed_deps = []
        changed_settings = []
        diff_summary = ""

        if has_changes:
            lines = r.stdout.split("\n")
            added = [l for l in lines if l.startswith("+") and not l.startswith("+++")]
            removed = [l for l in lines if l.startswith("-") and not l.startswith("---")]
            diff_summary = f"+{len(added)} -{len(removed)} lines"

            fname = os.path.basename(cf)
            if fname == "Cargo.toml" or fname == "package.json":
                in_deps = False
                for line in lines:
                    low = line.lower()
                    if "dependencies" in low:
                        in_deps = True
                    elif line.startswith("@@"):
                        in_deps = "dependencies" in low if low else in_deps
                    elif in_deps and line.startswith("+"):
                        m = dep_add_re.match(line)
                        if m:
                            added_deps.append(m.group(1).strip('"').strip("'"))
                    elif in_deps and line.startswith("-"):
                        m = dep_del_re.match(line)
                        if m:
                            removed_deps.append(m.group(1).strip('"').strip("'"))

            if "tsconfig" in fname.lower():
                for line in added + removed:
                    clean = line.lstrip("+-").strip().strip(",").strip('"')
                    if ":" in clean:
                        key = clean.split(":")[0].strip().strip('"')
                        if key and not key.startswith("//"):
                            changed_settings.append(key)
                changed_settings = list(set(changed_settings))

        results.append({
            "file": rel_path,
            "has_changes": has_changes,
            "diff_summary": diff_summary,
            "added_deps": added_deps,
            "removed_deps": removed_deps,
            "changed_settings": changed_settings,
        })

    return {"configs": results}


def generate_changelog(project_root: str, since: str = "", count: int = 50) -> str:
    try:
        if since:
            cmd = ["git", "log", f"{since}..HEAD", f"--pretty=format:%h|%an|%ad|%s", "--date=short"]
        else:
            cmd = ["git", "log", f"-{count}", f"--pretty=format:%h|%an|%ad|%s", "--date=short"]
        r = subprocess.run(cmd, cwd=project_root, capture_output=True, text=True, timeout=15)
        if r.returncode != 0:
            return f"Error: {r.stderr.strip()}"
    except (subprocess.TimeoutExpired, FileNotFoundError) as e:
        return f"Error: {e}"

    categories = {
        "Features": [], "Bug Fixes": [], "Refactoring": [],
        "Performance": [], "Documentation": [], "Tests": [],
        "Maintenance": [], "Other": [],
    }

    prefix_map = {
        "feat": "Features", "add": "Features",
        "fix": "Bug Fixes",
        "refactor": "Refactoring",
        "perf": "Performance",
        "docs": "Documentation", "doc": "Documentation",
        "test": "Tests", "tests": "Tests",
        "chore": "Maintenance", "ci": "Maintenance", "build": "Maintenance",
    }

    for line in r.stdout.strip().split("\n"):
        if not line.strip():
            continue
        parts = line.split("|", 3)
        if len(parts) < 4:
            continue
        sha, author, date, msg = parts

        cat = "Other"
        msg_lower = msg.lower().strip()
        for prefix, category in prefix_map.items():
            if msg_lower.startswith(prefix + ":") or msg_lower.startswith(prefix + "("):
                cat = category
                break

        categories[cat].append(f"- {msg} (`{sha}`, {author}, {date})")

    lines = ["# Changelog", ""]
    if since:
        lines.append(f"Changes since `{since}`")
        lines.append("")
    for cat, entries in categories.items():
        if not entries:
            continue
        lines.append(f"## {cat}")
        lines.append("")
        lines.extend(entries)
        lines.append("")

    return "\n".join(lines)


def save_context_snapshot(project_root: str, snapshot_data: dict) -> str:
    import json
    import time
    snapshot_data["_timestamp"] = time.time()
    snapshot_data["_branch"] = _get_current_branch(project_root)
    path = os.path.join(project_root, ".claude", "mcp", "code-docs-rag", "context_snapshot.json")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(snapshot_data, f, indent=2, ensure_ascii=False)
    return path


def load_context_snapshot(project_root: str) -> dict:
    import json
    path = os.path.join(project_root, ".claude", "mcp", "code-docs-rag", "context_snapshot.json")
    if not os.path.exists(path):
        return {"error": "No snapshot found"}
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def _get_current_branch(project_root: str) -> str:
    try:
        r = subprocess.run(
            ["git", "branch", "--show-current"],
            cwd=project_root, capture_output=True, text=True, timeout=5,
        )
        return r.stdout.strip() if r.returncode == 0 else ""
    except Exception:
        return ""

