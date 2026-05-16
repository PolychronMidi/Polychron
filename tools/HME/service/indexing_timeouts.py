"""Shared indexing-mode timeout settings."""
from __future__ import annotations

import json
import logging
import os
from pathlib import Path

_CFG = Path(__file__).resolve().parents[1] / "config" / "timeouts.json"
_DEFAULTS = {"shim_post_sec": 900.0, "daemon_join_sec": 930.0, "client_sec": 960.0}
logger = logging.getLogger("HME")


def _read_config() -> dict:
    try:
        with open(_CFG, encoding="utf-8") as f:
            return json.load(f).get("indexing", {})
    except Exception as exc:
        logger.debug(f"indexing timeout config read failed: {type(exc).__name__}: {exc}")
        return {}


def _num(cfg: dict, key: str) -> float:
    env_key = f"HME_INDEXING_{key.upper()}"
    raw = os.environ.get(env_key, cfg.get(key, _DEFAULTS[key]))
    try:
        return float(raw)
    except (TypeError, ValueError):
        return _DEFAULTS[key]


def indexing_timeouts() -> dict[str, float]:
    cfg = _read_config()
    shim = _num(cfg, "shim_post_sec")
    daemon = max(_num(cfg, "daemon_join_sec"), shim + 30)
    client = max(_num(cfg, "client_sec"), daemon + 30)
    return {"shim_post_sec": shim, "daemon_join_sec": daemon, "client_sec": client}
