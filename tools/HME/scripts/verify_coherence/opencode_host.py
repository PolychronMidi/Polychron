"""OpenCode host materialization verifier."""
from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
from pathlib import Path

from ._base import VerdictResult, Verifier, _PROJECT, failed, passed, register


@register
class OpenCodeHostVerifier(Verifier):
    """OpenCode must enter through HME provider ingress and hook bridge."""

    name = "opencode-host"
    category = "state"
    subtag = "host-materialization"
    weight = 1.5

    def run(self) -> VerdictResult:
        root = Path(_PROJECT)
        scripts = root / "tools" / "HME" / "scripts"
        if str(scripts) not in sys.path:
            sys.path.insert(0, str(scripts))
        try:
            spec = importlib.util.spec_from_file_location("opencode_settings", scripts / "opencode_settings.py")
            if spec is None or spec.loader is None:
                raise RuntimeError("unable to load opencode_settings.py")
            settings = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(settings)
        except Exception as exc:  # noqa: BLE001
            return failed(summary=f"opencode settings module import failed: {exc}")

        violations: list[str] = []
        try:
            proc = subprocess.run(
                ["node", "-e", "const {servicePort}=require('./tools/HME/proxy/service_registry'); process.stdout.write(String(servicePort('proxy')));"],
                cwd=root, capture_output=True, text=True, timeout=10, check=True,
            )
            port = int(proc.stdout.strip())
        except Exception as exc:  # noqa: BLE001
            return failed(summary=f"unable to resolve HME proxy port for OpenCode: {exc}")

        config_path = Path(settings.OPENCODE_CONFIG_PATH).expanduser()
        live = {}
        if config_path.exists():
            try:
                live = json.loads(settings.strip_jsonc(config_path.read_text(encoding="utf-8")))
                if not isinstance(live, dict):
                    violations.append(f"{config_path}: root must be a JSON object")
                    live = {}
            except Exception as exc:  # noqa: BLE001
                violations.append(f"{config_path}: unreadable JSONC: {exc}")
        else:
            violations.append(f"{config_path}: OpenCode config missing")

        expected = settings.managed_config(live, port, root)
        violations.extend(settings.compare_config(live, port, root))
        violations.extend(settings.path_violations(expected, port))
        if expected.get("model") != settings.DEFAULT_MODEL and not live.get("model"):
            violations.append("OpenCode default model was not materialized")
        if expected.get("small_model") != settings.DEFAULT_SMALL_MODEL and not live.get("small_model"):
            violations.append("OpenCode default small_model was not materialized")

        plugin = root / "tools" / "HME" / "opencode" / "plugin" / "hme_hooks.mjs"
        try:
            proc = subprocess.run(
                ["node", "--input-type=module", "-e", f"import('{plugin.as_uri()}').then(m=>{{if(typeof m.default!=='function') process.exit(2)}})"],
                cwd=root, capture_output=True, text=True, timeout=15,
            )
            if proc.returncode != 0:
                violations.append(f"OpenCode plugin import failed: {(proc.stderr or proc.stdout).strip()}")
        except Exception as exc:  # noqa: BLE001
            violations.append(f"OpenCode plugin import check errored: {exc}")

        if violations:
            score = max(0.0, 1.0 - len(violations) / 6.0)
            return failed(score=score, summary=f"{len(violations)} OpenCode host materialization issue(s)", details=violations[:20])
        return passed(summary=f"OpenCode provider/plugin materialized through HME at :{port}")
