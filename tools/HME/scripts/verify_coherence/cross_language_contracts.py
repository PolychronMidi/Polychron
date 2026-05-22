"""Cross-language contract verifier.

Treats Python<->JS<->JSON-schema as a coherence surface. The registry
file lists three contract kinds; drift between sides FAILs.

  - shared_sets: a named literal set (e.g. MUTATING_EFFECTS) that
    must hold identical string values at every listed site. Each site
    declares a regex with one capture group that bounds the literal;
    the verifier parses the captured fragment as a string set and
    diffs against the canonical values.

  - function_pairs: a logical operation implemented in both Python and
    JavaScript (e.g. to_omo_tool_descriptor / toOmoToolDescriptor). The
    verifier confirms both named symbols still exist in their declared
    files; behavioural equivalence is the responsibility of paired
    unit tests, but symbol disappearance is caught immediately.

  - schema_mirrors: a JSON schema whose `properties` keys must match
    the field annotations of a Python dataclass. Drift between schema
    and dataclass (added field on one side, removed on the other) is
    the bug class this catches.

Registry: tools/HME/config/cross_language_contracts.json
"""
from __future__ import annotations

import ast
import json
import re
from pathlib import Path

from ._base import (
    FAIL,
    PASS,
    SKIP,
    VerdictResult,
    Verifier,
    _PROJECT,
    failed,
    passed,
    register,
    skipped,
)

REGISTRY_REL = "tools/HME/config/cross_language_contracts.json"

_STRING_LITERAL_RE = re.compile(r"""['"]([^'"]+)['"]""")


def _parse_string_set(fragment: str) -> set[str]:
    return set(_STRING_LITERAL_RE.findall(fragment))


def _check_shared_set(root: Path, entry: dict) -> list[str]:
    name = entry.get("name", "<unnamed>")
    canonical = set(entry.get("values") or [])
    issues: list[str] = []
    for site in entry.get("sites") or []:
        rel = site.get("file", "")
        pat = site.get("pattern", "")
        abs_path = root / rel
        if not abs_path.is_file():
            issues.append(f"shared_set {name}: site file missing -- {rel}")
            continue
        try:
            text = abs_path.read_text(encoding="utf-8")
        except OSError as e:
            issues.append(f"shared_set {name}: cannot read {rel} -- {e}")
            continue
        try:
            rx = re.compile(pat, re.DOTALL)
        except re.error as e:
            issues.append(f"shared_set {name}: bad pattern at {rel} -- {e}")
            continue
        m = rx.search(text)
        if not m:
            issues.append(f"shared_set {name}: literal not found in {rel}")
            continue
        observed = _parse_string_set(m.group(1))
        if observed != canonical:
            missing = canonical - observed
            extra = observed - canonical
            parts = []
            if missing:
                parts.append(f"missing={sorted(missing)}")
            if extra:
                parts.append(f"extra={sorted(extra)}")
            issues.append(
                f"shared_set {name}: drift at {rel} -- {', '.join(parts)}"
            )
    return issues


_PY_DEF_RE = re.compile(r"^\s*(?:async\s+)?def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(", re.MULTILINE)
_JS_FUNC_DECL_RE = re.compile(r"^\s*(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(", re.MULTILINE)
_JS_FUNC_ASSIGN_RE = re.compile(r"^\s*(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(?:async\s+)?(?:function|\()", re.MULTILINE)
_JS_ARROW_RE = re.compile(r"^\s*(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>", re.MULTILINE)


def _py_symbols(text: str) -> set[str]:
    return set(_PY_DEF_RE.findall(text))


def _js_symbols(text: str) -> set[str]:
    return (
        set(_JS_FUNC_DECL_RE.findall(text))
        | set(_JS_FUNC_ASSIGN_RE.findall(text))
        | set(_JS_ARROW_RE.findall(text))
    )


def _check_function_pair(root: Path, entry: dict) -> list[str]:
    name = entry.get("name", "<unnamed>")
    issues: list[str] = []
    py = entry.get("py") or {}
    js = entry.get("js") or {}
    py_file = root / py.get("file", "")
    js_file = root / js.get("file", "")
    py_sym = py.get("symbol", "")
    js_sym = js.get("symbol", "")

    if not py_file.is_file():
        issues.append(f"function_pair {name}: missing Python file {py.get('file')}")
    else:
        try:
            if py_sym not in _py_symbols(py_file.read_text(encoding="utf-8")):
                issues.append(
                    f"function_pair {name}: Python symbol `{py_sym}` not defined in "
                    f"{py.get('file')}"
                )
        except OSError as e:
            issues.append(f"function_pair {name}: read error on {py.get('file')} -- {e}")

    if not js_file.is_file():
        issues.append(f"function_pair {name}: missing JS file {js.get('file')}")
    else:
        try:
            if js_sym not in _js_symbols(js_file.read_text(encoding="utf-8")):
                issues.append(
                    f"function_pair {name}: JS symbol `{js_sym}` not defined in "
                    f"{js.get('file')}"
                )
        except OSError as e:
            issues.append(f"function_pair {name}: read error on {js.get('file')} -- {e}")

    return issues


def _dataclass_field_names(source: str, class_name: str) -> set[str] | None:
    try:
        tree = ast.parse(source)
    except SyntaxError:
        return None
    for node in ast.walk(tree):
        if isinstance(node, ast.ClassDef) and node.name == class_name:
            fields: set[str] = set()
            for body_node in node.body:
                if isinstance(body_node, ast.AnnAssign) and isinstance(body_node.target, ast.Name):
                    fields.add(body_node.target.id)
                elif isinstance(body_node, ast.Assign):
                    for target in body_node.targets:
                        if isinstance(target, ast.Name):
                            fields.add(target.id)
            return fields
    return None


def _check_schema_mirror(root: Path, entry: dict) -> list[str]:
    name = entry.get("name", "<unnamed>")
    issues: list[str] = []
    schema_rel = entry.get("schema", "")
    dataclass_file = entry.get("dataclass_file", "")
    dataclass_name = entry.get("dataclass_name", "")
    schema_path = root / schema_rel
    py_path = root / dataclass_file

    if not schema_path.is_file():
        issues.append(f"schema_mirror {name}: schema missing -- {schema_rel}")
        return issues
    if not py_path.is_file():
        issues.append(f"schema_mirror {name}: dataclass file missing -- {dataclass_file}")
        return issues

    try:
        schema = json.loads(schema_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        issues.append(f"schema_mirror {name}: cannot parse {schema_rel} -- {e}")
        return issues

    props = schema.get("properties")
    if not isinstance(props, dict):
        issues.append(f"schema_mirror {name}: schema has no `properties` object")
        return issues
    schema_fields = set(props.keys())

    try:
        py_src = py_path.read_text(encoding="utf-8")
    except OSError as e:
        issues.append(f"schema_mirror {name}: cannot read {dataclass_file} -- {e}")
        return issues

    fields = _dataclass_field_names(py_src, dataclass_name)
    if fields is None:
        issues.append(
            f"schema_mirror {name}: dataclass `{dataclass_name}` not found in "
            f"{dataclass_file}"
        )
        return issues

    only_in_schema = schema_fields - fields
    only_in_class = fields - schema_fields
    if only_in_schema or only_in_class:
        parts = []
        if only_in_schema:
            parts.append(f"schema_only={sorted(only_in_schema)}")
        if only_in_class:
            parts.append(f"dataclass_only={sorted(only_in_class)}")
        issues.append(f"schema_mirror {name}: drift -- {', '.join(parts)}")
    return issues


@register
class CrossLanguageContractsVerifier(Verifier):
    """Pin cross-language contracts so drift fails fast."""

    name = "cross-language-contracts"
    category = "code"
    subtag = "interface-contract"
    weight = 1.5

    def run(self) -> VerdictResult:
        root = Path(_PROJECT)
        registry_path = root / REGISTRY_REL
        if not registry_path.is_file():
            return skipped(summary=f"no contract registry at {REGISTRY_REL}")
        try:
            registry = json.loads(registry_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as e:
            return failed(score=0.0, summary=f"registry unreadable -- {e}")

        issues: list[str] = []
        checked = 0
        for entry in registry.get("shared_sets") or []:
            issues.extend(_check_shared_set(root, entry))
            checked += 1
        for entry in registry.get("function_pairs") or []:
            issues.extend(_check_function_pair(root, entry))
            checked += 1
        for entry in registry.get("schema_mirrors") or []:
            issues.extend(_check_schema_mirror(root, entry))
            checked += 1

        if not issues:
            return passed(score=1.0, summary=f"{checked} cross-language contract(s) in lock-step")
        score = max(0.0, 1.0 - len(issues) / 10.0)
        return failed(score=score, summary=f"{len(issues)} cross-language contract drift(s) across {checked} entries", details=issues[:30])
