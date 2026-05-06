"""Buddy routing -- list_buddies + effective tier/effort + pick_buddy_for_task.

Extracted from buddy_dispatcher.py (was lines 258-422). The "which buddy gets
this task" cluster, separated from the queue lifecycle and drain orchestration.
buddy_dispatcher.py re-exports the public symbols.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from buddy_dispatcher import (  # noqa: E402
    PROJECT_ROOT, QUEUE_PROCESSING,
    TIER_ORDER, TIER_NAMES, EFFORT_ORDER, EFFORT_NAMES, TIER_TO_EFFORT,
    _BUDDY_SYSTEM_FLAG, _DISPATCH_MODE, _SYNTHESIS_TIERS,
    _translate_legacy_tier,
)


def _list_buddies() -> list[dict]:
    """Discover available co-buddies (or synthesize a virtual worker
    when HME_DISPATCH_MODE=synthesis). Returns list of dicts with
    {slot, sid, floor, effort_floor, sid_file, processing_dir}.

    When mode=synthesis, returns a single virtual worker that dispatches
    via synthesis_reasoning.call() -- no SID, no buddy session, no
    Anthropic API quota required. Lets the queue/manifest/orphan-sweep
    infrastructure stay useful when BUDDY_SYSTEM=0.
    """
    if _DISPATCH_MODE == "disabled":
        return []
    # Synthesis pseudo-buddy: present when (a) full-synthesis mode OR
    # (b) per-tier override is non-empty. In the per-tier case it
    # coexists with real buddies -- `_pick_buddy_for_task` routes each
    # task to the right worker based on the task's tier.
    synthesis_buddy = {
        "slot": 0,  # 0 distinguishes from real-buddy slots (1..N)
        "sid": "synthesis",  # sentinel: dispatch routes through synthesis_reasoning
        "floor": "E2",
        "effort_floor": "low",
        "sid_file": None,
        "processing_dir": QUEUE_PROCESSING / "synthesis-1",
    }
    if _DISPATCH_MODE == "synthesis":
        # Pure-synthesis: only the pseudo-buddy. `_pick_buddy_for_task`
        # will route every tier through it (since _SYNTHESIS_TIERS was
        # set to the full TIER_NAMES set above).
        return [synthesis_buddy]
    buddies = []
    tmp = PROJECT_ROOT / "tmp"
    def _read_floor_pair(sid_file: Path):
        """Read companion .floor and .effort_floor files; legacy easy/medium/hard
        translate (easy->E2, medium->E3, hard->E4). Missing files default to
        E2/low (dynamic buddy)."""
        floor_file = sid_file.with_suffix(".floor")
        effort_file = sid_file.with_suffix(".effort_floor")
        raw_floor = floor_file.read_text().strip() if floor_file.exists() else "E2"
        m_floor = _translate_legacy_tier(raw_floor)
        if effort_file.exists():
            e_floor = effort_file.read_text().strip()
            if e_floor not in EFFORT_NAMES:
                e_floor = TIER_TO_EFFORT.get(m_floor, "low")
        else:
            e_floor = TIER_TO_EFFORT.get(m_floor, "low")
        return m_floor, e_floor
    # Single-buddy back-compat path
    legacy_sid = tmp / "hme-buddy.sid"
    if legacy_sid.exists() and legacy_sid.read_text().strip():
        m_floor, e_floor = _read_floor_pair(legacy_sid)
        buddies.append({
            "slot": 1,
            "sid": legacy_sid.read_text().strip(),
            "floor": m_floor,
            "effort_floor": e_floor,
            "sid_file": legacy_sid,
            "processing_dir": QUEUE_PROCESSING / "buddy-1",
        })
    else:
        # Multi-buddy fanout path
        for sid_file in sorted(tmp.glob("hme-buddy-[0-9]*.sid")):
            sid = sid_file.read_text().strip() if sid_file.exists() else ""
            if not sid:
                continue
            # Slot from filename: hme-buddy-N.sid -> N
            try:
                slot = int(sid_file.stem.rsplit("-", 1)[1])
            except (ValueError, IndexError):
                continue
            m_floor, e_floor = _read_floor_pair(sid_file)
            buddies.append({
                "slot": slot,
                "sid": sid,
                "floor": m_floor,
                "effort_floor": e_floor,
                "sid_file": sid_file,
                "processing_dir": QUEUE_PROCESSING / f"buddy-{slot}",
            })
    # Per-tier override: append the synthesis pseudo so
    # _pick_buddy_for_task can route easy-tier (or whichever tiers are
    # listed) through the free cascade alongside the real buddies. With
    # an empty _SYNTHESIS_TIERS set this is a no-op.
    if _SYNTHESIS_TIERS:
        buddies.append(synthesis_buddy)
    return buddies


def _effective_tier(item_tier: str, buddy_floor: str) -> str:
    """`effective = max(item_tier, buddy_floor)` (model axis). Legacy values translate."""
    item_n = TIER_ORDER.get(_translate_legacy_tier(item_tier), 2)
    floor_n = TIER_ORDER.get(_translate_legacy_tier(buddy_floor), 2)
    return TIER_NAMES[max(item_n, floor_n)]


def _effective_effort(item_tier: str, effort_floor: str) -> str:
    """`effective = max(item_effort, buddy_effort_floor)` (effort axis, parallel to model).
    Tier maps to canonical effort via TIER_TO_EFFORT; effort_floor escalates."""
    item_effort = TIER_TO_EFFORT.get(_translate_legacy_tier(item_tier), "medium")
    item_n = EFFORT_ORDER.get(item_effort, 1)
    floor_n = EFFORT_ORDER.get(effort_floor, 1)
    return EFFORT_NAMES[max(item_n, floor_n)]


def _pick_buddy_for_task(task: dict, buddies: list[dict], busy: set[int]) -> dict | None:
    """Select a non-busy buddy whose effective tier (after floor
    escalation) best matches the task tier.

    Per-tier synthesis routing: if the task's tier is in
    `HME_DISPATCH_SYNTHESIS_TIERS`, prefer the synthesis pseudo-buddy
    (sid='synthesis', slot=0) -- it routes through the free cascade
    without burning the buddy session's quota. The real buddy is the
    fallback when synthesis is busy or not present.

    For tiers NOT in the per-tier set, route to the real buddies and
    explicitly skip synthesis (otherwise easy work could starve the
    free path while medium/hard floods the buddy).

    Strategy among real buddies: prefer floor == item_tier (no
    escalation), else lowest floor that's free (cheapest option that
    doesn't downgrade)."""
    item_tier = task.get("tier", "medium")
    if item_tier not in TIER_NAMES:
        item_tier = "medium"
    item_n = TIER_ORDER[item_tier]
    free = [b for b in buddies if b["slot"] not in busy]
    if not free:
        return None
    routes_to_synthesis = item_tier in _SYNTHESIS_TIERS
    if routes_to_synthesis:
        # Prefer the synthesis worker first; fall back to a real buddy
        # if synthesis is busy (slot 0 in `busy`).
        for b in free:
            if b.get("sid") == "synthesis":
                return b
        # Synthesis not available -- fall through to real-buddy selection
        # rather than refusing the task. Logged in stats by the caller.
        free = [b for b in free if b.get("sid") != "synthesis"]
        if not free:
            return None
    else:
        # Tier doesn't route to synthesis -- exclude synthesis pseudo
        # from candidates so a medium/hard task never lands on the
        # free cascade unintentionally.
        free = [b for b in free if b.get("sid") != "synthesis"]
        if not free:
            return None

    def _cost(b):
        f = TIER_ORDER.get(b["floor"], 1)
        if f == item_n:
            return 0
        if f < item_n:
            return item_n - f
        return (f - item_n) + 10
    free.sort(key=_cost)
    return free[0]

