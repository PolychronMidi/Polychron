#!/usr/bin/env python3
"""Shared helpers for music21 export scripts."""

from __future__ import annotations

import json
from typing import Any, Dict, Iterable, Mapping


def round3(value: float) -> float:
    return round(float(value), 3)


def interpolate_nested(primary: Dict[str, Any], secondary: Mapping[str, Any], t: float) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    for key, p_val in primary.items():
        s_val = secondary.get(key, p_val)
        if isinstance(p_val, dict) and isinstance(s_val, dict):
            out[key] = interpolate_nested(p_val, s_val, t)
        else:
            out[key] = round3(float(p_val) * (1.0 - t) + float(s_val) * t)
    return out


def merge_numeric_maps(
    primary: Mapping[str, float],
    secondary: Mapping[str, float],
    t: float,
    default: float = 1.0,
) -> Dict[str, float]:
    out: Dict[str, float] = {}
    for key in set(list(primary.keys()) + list(secondary.keys())):
        p_val = float(primary.get(key, default))
        s_val = float(secondary.get(key, default))
        out[key] = round3(p_val * (1.0 - t) + s_val * t)
    return out


def scale_harmonic_patterns(profile: Mapping[str, Any], factor: float) -> Dict[str, Dict[str, Any]]:
    out: Dict[str, Dict[str, Any]] = {}
    patterns = profile.get("patterns", {})
    for key, pattern in patterns.items():
        p = dict(pattern)
        if isinstance(p.get("romans"), list):
            p["romans"] = list(p["romans"])
        p["baseWeight"] = round3(float(p["baseWeight"]) * factor)
        out[key] = p
    return out


def scale_harmonic_phase_weights(
    profile: Mapping[str, Any],
    phases: Iterable[str],
    factor: float,
) -> Dict[str, Dict[str, float]]:
    out: Dict[str, Dict[str, float]] = {phase: {} for phase in phases}
    phase_weights = profile.get("phaseWeights", {})
    for phase in phases:
        for key, weight in phase_weights.get(phase, {}).items():
            out[phase][key] = round3(float(weight) * factor)
    return out


def to_js_assignment(var_name: str, data: Dict[str, Any], generator_script: str) -> str:
    pretty = json.dumps(data, indent=2)
    header = f"// GENERATED FILE - DO NOT EDIT. Run: {generator_script}\n"
    return f"{header}{var_name} = {pretty};\n"
