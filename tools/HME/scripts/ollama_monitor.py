#!/usr/bin/env python3
"""Ollama fleet monitor — logs model sizes, VRAM/RAM, context, and temps every 60s.

Writes JSONL to log/ollama-monitor.jsonl. Alerts on:
  - Model exceeding size limit (GPU: VRAM-500MB, CPU: 12GB)
  - Model unloaded/unreachable
  - CPU or GPU thermal throttle thresholds
  - RAM pressure (available < 8GB)

Run: python3 tools/HME/scripts/ollama_monitor.py [--interval 60] [--once]
"""
import json
import os
import subprocess
import sys
import time
import urllib.request

_DIR = os.path.dirname(os.path.abspath(__file__))
_PROJECT = os.path.normpath(os.path.join(_DIR, "..", "..", ".."))
LOG_PATH = os.path.join(_PROJECT, "log", "ollama-monitor.jsonl")

INSTANCES = [
    {"name": "GPU0", "port": 11434, "type": "gpu", "gpu_idx": 0,
     "max_mb": 23040 - 500},
    {"name": "GPU1", "port": 11435, "type": "gpu", "gpu_idx": 1,
     "max_mb": 23040 - 500},
    {"name": "CPU",  "port": 11436, "type": "cpu", "gpu_idx": -1,
     "max_mb": 12 * 1024},
]

GPU_TEMP_WARN = 80
GPU_TEMP_CRIT = 88
CPU_TEMP_WARN = 90
CPU_TEMP_CRIT = 100
RAM_LOW_MB = 8192


def _query_ollama(port: int) -> dict:
    try:
        req = urllib.request.Request(f"http://localhost:{port}/api/ps")
        with urllib.request.urlopen(req, timeout=5) as resp:
            return json.loads(resp.read())
    except Exception as e:
        return {"error": str(e)[:80]}


def _gpu_stats() -> list[dict]:
    try:
        out = subprocess.run(
            ["nvidia-smi",
             "--query-gpu=index,memory.used,memory.total,temperature.gpu,power.draw",
             "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=5
        )
        stats = []
        for line in out.stdout.strip().splitlines():
            p = [x.strip() for x in line.split(",")]
            if len(p) >= 5:
                stats.append({
                    "idx": int(p[0]),
                    "mem_used_mb": int(float(p[1])),
                    "mem_total_mb": int(float(p[2])),
                    "temp_c": int(float(p[3])),
                    "power_w": round(float(p[4]), 1),
                })
        return stats
    except Exception as e:
        return [{"error": str(e)[:60]}]


def _cpu_temp() -> float | None:
    # Try coretemp via sysfs (most reliable on Intel)
    try:
        base = "/sys/class/hwmon"
        for hwmon in sorted(os.listdir(base)):
            name_path = os.path.join(base, hwmon, "name")
            if os.path.exists(name_path):
                with open(name_path) as f:
                    name = f.read().strip()
                if name == "coretemp":
                    # Read Package id 0 (temp1_input) — the die temp
                    pkg_path = os.path.join(base, hwmon, "temp1_input")
                    if os.path.exists(pkg_path):
                        with open(pkg_path) as f:
                            return int(f.read().strip()) / 1000.0
    except Exception:
        pass
    # Fallback: thermal_zone
    try:
        for zone in sorted(os.listdir("/sys/class/thermal/")):
            if zone.startswith("thermal_zone"):
                tpath = f"/sys/class/thermal/{zone}/type"
                vpath = f"/sys/class/thermal/{zone}/temp"
                if os.path.exists(tpath) and os.path.exists(vpath):
                    with open(tpath) as f:
                        ztype = f.read().strip()
                    if "pkg" in ztype.lower() or "x86" in ztype.lower():
                        with open(vpath) as f:
                            return int(f.read().strip()) / 1000.0
    except Exception:
        pass
    return None


def _ram_info() -> dict:
    try:
        with open("/proc/meminfo") as f:
            info = {}
            for line in f:
                parts = line.split()
                if len(parts) >= 2:
                    info[parts[0].rstrip(":")] = int(parts[1])
            total = info.get("MemTotal", 0) // 1024
            avail = info.get("MemAvailable", 0) // 1024
            return {"total_mb": total, "available_mb": avail, "used_mb": total - avail}
    except Exception:
        return {}


def _tmpfs_buffer_status() -> list[dict]:
    """Check if tmpfs overflow buffers exist and report their usage."""
    buffers = []
    for name in ("gpu0", "gpu1"):
        path = f"/mnt/ollama-buffer-{name}"
        if os.path.ismount(path):
            try:
                st = os.statvfs(path)
                total_mb = (st.f_blocks * st.f_frsize) // (1024 * 1024)
                free_mb = (st.f_bfree * st.f_frsize) // (1024 * 1024)
                buffers.append({"name": name, "total_mb": total_mb,
                                "used_mb": total_mb - free_mb, "mounted": True})
            except Exception:
                buffers.append({"name": name, "mounted": True, "error": "statvfs failed"})
        else:
            buffers.append({"name": name, "mounted": False})
    return buffers


def monitor_tick() -> dict:
    ts = time.time()
    entry = {"ts": ts, "iso": time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime(ts)),
             "models": [], "gpu": [], "cpu_temp_c": None, "ram": {},
             "buffers": [], "alerts": []}

    # ── Ollama instances ──
    for inst in INSTANCES:
        data = _query_ollama(inst["port"])
        if "error" in data:
            entry["alerts"].append(f"{inst['name']}: UNREACHABLE ({data['error'][:40]})")
            entry["models"].append({"instance": inst["name"], "status": "unreachable"})
            continue
        models = data.get("models", [])
        if not models:
            entry["alerts"].append(f"{inst['name']}: NO MODEL LOADED — cold start latency imminent")
            entry["models"].append({"instance": inst["name"], "status": "unloaded"})
            continue
        for m in models:
            size_mb = m.get("size", 0) / (1024 * 1024)
            vram_mb = m.get("size_vram", 0) / (1024 * 1024)
            ctx = m.get("context_length", 0)
            model_entry = {
                "instance": inst["name"],
                "model": m.get("name", "?"),
                "size_mb": round(size_mb, 1),
                "vram_mb": round(vram_mb, 1),
                "context": ctx,
                "type": inst["type"],
            }
            entry["models"].append(model_entry)
            # Size limit check
            effective_mb = vram_mb if inst["type"] == "gpu" else size_mb
            if effective_mb > inst["max_mb"]:
                overshoot = effective_mb - inst["max_mb"]
                entry["alerts"].append(
                    f"{inst['name']} OVER LIMIT: {effective_mb:.0f}MB "
                    f"(+{overshoot:.0f}MB over {inst['max_mb']}MB cap) "
                    f"model={m.get('name','?')} ctx={ctx}"
                )

    # ── GPU stats ──
    entry["gpu"] = _gpu_stats()
    for g in entry["gpu"]:
        if "error" in g:
            continue
        t = g.get("temp_c", 0)
        idx = g.get("idx", "?")
        if t >= GPU_TEMP_CRIT:
            entry["alerts"].append(f"GPU{idx} THERMAL CRITICAL: {t}°C (>{GPU_TEMP_CRIT}°C)")
        elif t >= GPU_TEMP_WARN:
            entry["alerts"].append(f"GPU{idx} THERMAL WARNING: {t}°C (>{GPU_TEMP_WARN}°C)")

    # ── CPU temp ──
    entry["cpu_temp_c"] = _cpu_temp()
    if entry["cpu_temp_c"]:
        ct = entry["cpu_temp_c"]
        if ct >= CPU_TEMP_CRIT:
            entry["alerts"].append(f"CPU THERMAL CRITICAL: {ct:.0f}°C — kernel throttling/eviction likely")
        elif ct >= CPU_TEMP_WARN:
            entry["alerts"].append(f"CPU THERMAL WARNING: {ct:.0f}°C")

    # ── RAM ──
    entry["ram"] = _ram_info()
    avail = entry["ram"].get("available_mb", 99999)
    if avail < RAM_LOW_MB:
        entry["alerts"].append(f"RAM LOW: {avail}MB available (threshold {RAM_LOW_MB}MB)")

    # ── tmpfs buffers ──
    entry["buffers"] = _tmpfs_buffer_status()

    return entry


def _fmt_summary(entry: dict) -> str:
    parts = []
    for m in entry["models"]:
        if m.get("model"):
            if m["type"] == "gpu":
                parts.append(f"{m['instance']}:{m['model']}={m['vram_mb']:.0f}MB/VRAM ctx={m['context']}")
            else:
                parts.append(f"{m['instance']}:{m['model']}={m['size_mb']:.0f}MB/RAM ctx={m['context']}")
        elif m.get("status"):
            parts.append(f"{m['instance']}:{m['status']}")
    gpu_temps = [f"GPU{g['idx']}:{g['temp_c']}°C/{g['power_w']}W"
                 for g in entry.get("gpu", []) if isinstance(g, dict) and "temp_c" in g]
    cpu_t = f"CPU:{entry['cpu_temp_c']:.0f}°C" if entry.get("cpu_temp_c") else ""
    ram = entry.get("ram", {})
    ram_t = f"RAM:{ram.get('used_mb', 0)//1024}G/{ram.get('total_mb', 0)//1024}G" if ram else ""
    buf_parts = []
    for b in entry.get("buffers", []):
        if b.get("mounted"):
            buf_parts.append(f"buf-{b['name']}:{b.get('used_mb', 0)}MB/{b.get('total_mb', 0)}MB")
    return (f"{entry['iso']} | {' | '.join(parts)} | "
            f"{' '.join(gpu_temps)} {cpu_t} {ram_t}"
            + (f" | {' '.join(buf_parts)}" if buf_parts else ""))


def run_daemon(interval: int = 60):
    os.makedirs(os.path.dirname(LOG_PATH), exist_ok=True)
    print(f"Ollama monitor started (interval={interval}s, log={LOG_PATH})")
    print(f"Limits: GPU={INSTANCES[0]['max_mb']}MB, CPU={INSTANCES[2]['max_mb']}MB")
    print(f"Thresholds: GPU {GPU_TEMP_WARN}/{GPU_TEMP_CRIT}°C, CPU {CPU_TEMP_WARN}/{CPU_TEMP_CRIT}°C, RAM<{RAM_LOW_MB}MB")
    print("---")
    while True:
        try:
            entry = monitor_tick()
            with open(LOG_PATH, "a") as f:
                f.write(json.dumps(entry) + "\n")
            if entry["alerts"]:
                for a in entry["alerts"]:
                    print(f"  [ALERT] {a}")
            print(_fmt_summary(entry))
        except Exception as e:
            print(f"  [ERROR] monitor tick failed: {e}", file=sys.stderr)
        time.sleep(interval)


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Ollama fleet monitor")
    parser.add_argument("--interval", type=int, default=60)
    parser.add_argument("--once", action="store_true", help="Single tick, JSON to stdout")
    args = parser.parse_args()
    if args.once:
        print(json.dumps(monitor_tick(), indent=2))
    else:
        run_daemon(args.interval)
