#!/usr/bin/env python3
import json
import sqlite3
import sys
from pathlib import Path

DB = Path.home() / ".omniroute" / "storage.sqlite"


def _setting(key: str):
    con = sqlite3.connect(DB)
    row = con.execute(
        "select value from key_value where namespace='settings' and key=?", (key,)
    ).fetchone()
    return json.loads(row[0]) if row else None


def main() -> int:
    thinking = _setting("thinkingBudget")
    rules = _setting("payloadRules")
    assert thinking == {"mode": "adaptive", "customBudget": 131072, "effortLevel": "xhigh"}
    defaults = rules.get("default") if isinstance(rules, dict) else None
    assert isinstance(defaults, list) and len(defaults) >= 2
    params = [r.get("params", {}) for r in defaults]
    assert {"reasoning_effort": "xhigh"} in params
    assert {"thinkingLevel": "xhigh"} in params
    print("omniroute_max_reasoning_probe=ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
