"""HME hot reload: reload a selection of tool modules without restarting worker."""
from __future__ import annotations

import importlib
import logging
import os
import sys

from server import context as ctx
from ... import _track
from ._shared import RELOADABLE, TOP_LEVEL_RELOADABLE, ROOT_RELOADABLE

logger = logging.getLogger("HME")


@ctx.mcp.tool(meta={"hidden": True})
def hme_hot_reload(modules: str = "") -> str:
    """Hot-reload HME tool modules without restarting the server.

    Works against the dict-backed `tool_registry._TOOLS` — the FastMCP
    replacement. Re-importing a module causes its `@ctx.mcp.tool()` calls
    to overwrite the registry entries, so the only state we need to manage
    is stale-pyc nuking and the before/after tool-name diff for reporting.
    """
    _track("hme_hot_reload")
    from server import tool_registry

    if not modules or modules.strip().lower() == "all":
        targets = RELOADABLE + TOP_LEVEL_RELOADABLE + ROOT_RELOADABLE
    else:
        targets = [m.strip() for m in modules.split(",") if m.strip()]

    _tools = tool_registry._TOOLS

    def _tools_owned_by(module_name: str) -> set:
        owned = set()
        for tname, entry in _tools.items():
            fn = entry.get("fn")
            mod = getattr(fn, "__module__", "")
            if mod == module_name:
                owned.add(tname)
                continue
            wrapped = getattr(fn, "__wrapped__", None)
            if wrapped is not None and getattr(wrapped, "__module__", "") == module_name:
                owned.add(tname)
        return owned

    results = []
    for name in targets:
        if name in ROOT_RELOADABLE:
            full = name
        elif name in TOP_LEVEL_RELOADABLE:
            full = f"server.{name}"
        else:
            full = f"server.tools_analysis.{name}"
        mod = sys.modules.get(full)
        # Subpackage fallback: modules moved to synthesis/, evolution/, coupling/
        if mod is None:
            for subpkg in ("synthesis", "evolution", "coupling"):
                mod = sys.modules.get(f"server.tools_analysis.{subpkg}.{name}")
                if mod:
                    break
        if mod is None:
            try:
                if name in ROOT_RELOADABLE:
                    mod = importlib.import_module(name)
                elif name in TOP_LEVEL_RELOADABLE:
                    mod = importlib.import_module(f".{name}", "server")
                else:
                    try:
                        mod = importlib.import_module(f".{name}", "server.tools_analysis")
                    except (ImportError, ModuleNotFoundError):
                        for subpkg in ("synthesis", "evolution", "coupling"):
                            try:
                                mod = importlib.import_module(f".{name}", f"server.tools_analysis.{subpkg}")
                                break
                            except (ImportError, ModuleNotFoundError):
                                continue
                        else:
                            raise
                actual_full = getattr(mod, "__name__", full)
                tools_new = _tools_owned_by(actual_full)
                results.append(f"  NEW {name}: {len(tools_new)} tools loaded")
            except Exception as e:
                results.append(f"  ERR {name} (import): {e}")
            continue

        actual_full = getattr(mod, "__name__", full)
        tools_before = _tools_owned_by(actual_full)
        # Snapshot entries BEFORE deleting so we can roll back on reload failure.
        snapshot = {tname: _tools[tname] for tname in tools_before if tname in _tools}
        for tname in tools_before:
            _tools.pop(tname, None)

        # Nuke the compiled bytecode BEFORE reloading. If the .pyc is newer
        # than the .py source (common after a prior successful reload), Python
        # will use the stale bytecode and the "OK" verdict silently hides that
        # the new source never ran.
        _mod_file = getattr(mod, "__file__", None)
        if _mod_file:
            _pycache_dir = os.path.join(os.path.dirname(_mod_file), "__pycache__")
            _stem = os.path.splitext(os.path.basename(_mod_file))[0]
            if os.path.isdir(_pycache_dir):
                for _pyc_entry in os.listdir(_pycache_dir):
                    if _pyc_entry.startswith(_stem + ".") and _pyc_entry.endswith(".pyc"):
                        try:
                            os.remove(os.path.join(_pycache_dir, _pyc_entry))
                        except OSError as _unlink_err:
                            logger.debug(f"pycache nuke {_pyc_entry}: {type(_unlink_err).__name__}: {_unlink_err}")
        try:
            # For packages that ship their logic across submodules (e.g.
            # `symbols` → symbols/patterns.py + symbols/extractor.py),
            # reloading only the top-level `__init__.py` leaves the stale
            # submodule objects in sys.modules. Reload submodules FIRST so
            # the package re-import below picks up the fresh versions.
            _pkg_prefix = actual_full + "."
            _submods = [_name for _name in list(sys.modules.keys())
                        if _name.startswith(_pkg_prefix)]
            for _sub_name in _submods:
                _sub_mod = sys.modules.get(_sub_name)
                if _sub_mod is None:
                    continue
                # Nuke the submodule's pycache too — stale bytecode defeats
                # reload silently just like at the top level.
                _sub_file = getattr(_sub_mod, "__file__", None)
                if _sub_file:
                    _sub_pc = os.path.join(os.path.dirname(_sub_file), "__pycache__")
                    _sub_stem = os.path.splitext(os.path.basename(_sub_file))[0]
                    if os.path.isdir(_sub_pc):
                        for _pyc in os.listdir(_sub_pc):
                            if _pyc.startswith(_sub_stem + ".") and _pyc.endswith(".pyc"):
                                try:
                                    os.remove(os.path.join(_sub_pc, _pyc))
                                except OSError as _sub_unlink_err:
                                    logger.debug(f"pycache nuke submod {_pyc}: {type(_sub_unlink_err).__name__}: {_sub_unlink_err}")
                try:
                    importlib.reload(_sub_mod)
                except Exception as _sub_reload_err:
                    logger.debug(f"submodule reload {_sub_name}: {type(_sub_reload_err).__name__}: {_sub_reload_err}")
            importlib.reload(mod)
        except Exception as e:
            # Roll back: restore the snapshot so a failed reload doesn't
            # leave the tool surface amputated.
            for tname, entry in snapshot.items():
                _tools[tname] = entry
            results.append(f"  ERR {name}: {e}")
            continue

        tools_after = _tools_owned_by(actual_full)
        removed = tools_before - tools_after
        added = tools_after - tools_before
        status_str = f"{len(tools_after)} tools"
        if removed:
            status_str += f" (-{len(removed)}: {', '.join(sorted(removed))})"
        if added:
            status_str += f" (+{len(added)}: {', '.join(sorted(added))})"
        results.append(f"  OK {name}: {status_str} (was {len(tools_before)})")

    total_tools = len(_tools)
    summary = f"## HME Hot Reload\n" + "\n".join(results) + f"\n\nTotal tools registered: {total_tools}"

    # Surface the reload as an observable artifact. Both manual
    # (i/hme-admin action=reload) and auto (watcher.py debounced) paths
    # converge here, so writing the marker here covers both. `i/state`
    # reads it to show "last hot-reload Ns ago".
    try:
        import json as _json
        import time as _time
        _root = ctx.PROJECT_ROOT
        _marker_path = os.path.join(_root, "tmp", "hme-last-reload.json")
        _marker_tmp = _marker_path + ".tmp"
        # Caller hint: watcher.py calls with empty modules string for auto;
        # manual i/hme-admin invocations may pass "all" or specific names.
        _trigger = "manual" if modules and modules.strip() else "auto"
        with open(_marker_tmp, "w") as _mf:
            _json.dump({
                "ts": _time.time(),
                "trigger": _trigger,
                "summary": summary.split("\n\n")[-1][:160],
            }, _mf)
        os.replace(_marker_tmp, _marker_path)
    except (OSError, AttributeError) as _werr:
        logger.debug("hot-reload marker write failed: %s", _werr)

    return summary


