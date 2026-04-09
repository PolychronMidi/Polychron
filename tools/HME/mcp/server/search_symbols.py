"""HME search tools — symbol search: find_callers, find_anti_pattern."""
import logging
import os

from server import context as ctx
from symbols import find_callers as _find_callers

logger = logging.getLogger("HME")


def find_callers(symbol_name: str, language: str = "", path: str = "", exclude_path: str = "") -> str:
    """Find all call sites. Use path='src/crossLayer' to scope. Use exclude_path='src/conductor' to find boundary violations."""
    if not symbol_name.strip():
        return "Error: symbol_name cannot be empty."
    if len(symbol_name.strip()) < 2:
        return f"Error: symbol_name '{symbol_name}' is too short (min 2 chars) — would match too many sites."
    results = _find_callers(symbol_name, ctx.PROJECT_ROOT, lang_filter=language)
    # Scoped filtering
    if path:
        results = [r for r in results if path in r.get('file', '')]
    if exclude_path:
        results = [r for r in results if exclude_path not in r.get('file', '')]
    if not results:
        scope_msg = f" (path='{path}')" if path else ""
        exclude_msg = f" (exclude='{exclude_path}')" if exclude_path else ""
        return f"No callers found for '{symbol_name}'{scope_msg}{exclude_msg}."

    lines = [f"  {r['file']}:{r['line']} - {r['text']}" for r in results[:50]]
    overflow = f"\n  ... and {len(results) - 50} more" if len(results) > 50 else ""
    return f"Found {len(results)} call site(s) for '{symbol_name}':\n" + "\n".join(lines) + overflow


def find_anti_pattern(wrong_symbol: str, right_symbol: str, path: str = "", exclude_path: str = "") -> str:
    """Find boundary violations: files using wrong_symbol (the banned direct access) that should use right_symbol (the approved bridge/wrapper) instead. Example: find_anti_pattern wrong_symbol='conductorState' right_symbol='conductorSignalBridge'. Auto-excludes the file that defines right_symbol."""
    if not wrong_symbol.strip():
        return "Error: wrong_symbol cannot be empty."
    if not right_symbol.strip():
        return "Error: right_symbol cannot be empty."
    wrong_results = _find_callers(wrong_symbol, ctx.PROJECT_ROOT)
    right_results = _find_callers(right_symbol, ctx.PROJECT_ROOT)
    # Auto-exclude files that define/implement the right_symbol (the bridge, not a violation)
    right_base = right_symbol.split('.')[0] if '.' in right_symbol else right_symbol
    if path:
        wrong_results = [r for r in wrong_results if path in r.get('file', '')]
    if exclude_path:
        wrong_results = [r for r in wrong_results if exclude_path not in r.get('file', '')]
    # Auto-exclude bridge definition files (file name contains the right_symbol base name)
    wrong_results = [r for r in wrong_results if right_base.lower() not in os.path.basename(r.get('file', '')).lower()]
    # Files using the wrong symbol
    wrong_files = set(r['file'] for r in wrong_results)
    # Files using the right symbol (these are OK)
    right_files = set(r['file'] for r in right_results)
    # Violations: files using wrong but NOT right
    violations = wrong_files - right_files
    violation_results = [r for r in wrong_results if r['file'] in violations]
    if not violation_results:
        mixed = wrong_files & right_files
        if mixed:
            return f"No pure violations. {len(mixed)} file(s) use both '{wrong_symbol}' and '{right_symbol}' (mixed usage)."
        return f"No files use '{wrong_symbol}' in the specified scope."
    lines = [f"  {r['file'].replace(ctx.PROJECT_ROOT + '/', '')}:{r['line']} - {r['text']}" for r in violation_results[:30]]
    overflow = f"\n  ... and {len(violation_results) - 30} more (use path= to narrow)" if len(violation_results) > 30 else ""
    # Show subsystem breakdown when violations span multiple subsystems
    subsystem_counts: dict = {}
    for r in violation_results:
        rel = r['file'].replace(ctx.PROJECT_ROOT + '/', '')
        parts_path = rel.split('/')
        sub = parts_path[1] if len(parts_path) > 2 and parts_path[0] == 'src' else parts_path[0]
        subsystem_counts[sub] = subsystem_counts.get(sub, 0) + 1
    breakdown = ""
    if len(subsystem_counts) > 1:
        breakdown = "\n  Breakdown: " + ", ".join(f"{k}:{v}" for k, v in sorted(subsystem_counts.items(), key=lambda x: -x[1]))
        breakdown += f"\n  Tip: use path='src/<subsystem>' to scope to a specific layer"
    return f"ANTI-PATTERN: {len(violations)} file(s) use '{wrong_symbol}' but not '{right_symbol}':{breakdown}\n" + "\n".join(lines) + overflow
