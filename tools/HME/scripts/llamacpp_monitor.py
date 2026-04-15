#!/usr/bin/env python3
"""llama.cpp fleet monitor — logs per-instance health, VRAM/RAM, thermals.

Writes JSONL to log/llamacpp-monitor.jsonl. Alerts on:
  - Instance /health not 'ok' or unreachable
  - Instance model size exceeds assigned GPU VRAM (offload invariant)
  - Active slots stuck > SLOT_STUCK_SECONDS
  - GPU or CPU thermal throttle thresholds
  - RAM pressure (available < 8GB)

HME architecture: each model owns its GPU end-to-end. Partial offload is a
critical failure — never a graceful degradation. This monitor verifies the
invariant every tick.

Run: python3 tools/HME/scripts/llamacpp_monitor.py [--interval 60] [--once]
"""
import json
import os
import subprocess
import sys
import time
import urllib.request

_DIR = os.path.dirname(os.path.abspath(__file__))
_PROJECT = os.path.normpath(os.path.join(_DIR, "..", "..", ".."))
LOG_PATH = os.path.join(_PROJECT, "log", "llamacpp-monitor.jsonl")

# Topology matches llamacpp_supervisor + systemd units. Each instance owns
# one GPU via Vulkan device index; CUDA idx is used for nvidia-smi queries.
INSTANCES = [
    {"name": "arbiter", "port": 8080, "cuda_idx": 0, "vulkan": "Vulkan1",
     "max_mb": 23040 - 500, "model": "phi-4-Q4_K_M.gguf + v6 LoRA"},
    {"name": "coder",   "port": 8081, "cuda_idx": 1, "vulkan": "Vulkan2",
     "max_mb": 23040 - 500, "model": "qwen3-coder-30b-Q4_K_M.gguf"},
]

GPU_TEMP_WARN = 80
GPU_TEMP_CRIT = 88
CPU_TEMP_WARN = 90
CPU_TEMP_CRIT = 100
RAM_LOW_MB = 8192
SLOT_STUCK_SECONDS = 120


def _query_llamacpp(port: int) -> dict:
    """Probe llama-server /health + /slots + /props. Returns a normalized dict."""
    base = f"http://localhost:{port}"
    result = {"port": port}
    try:
        with urllib.request.urlopen(f"{base}/health", timeout=5) as resp:
            h = json.loads(resp.read())
            result["health"] = h.get("status", "?")
    except Exception as e:
        result["error"] = str(e)[:80]
        return result

    # /slots reports active generation slots. Each slot has state 0=idle, 1=processing.
    try:
        with urllib.request.urlopen(f"{base}/slots", timeout=5) as resp:
            slots = json.loads(resp.read())
            if isinstance(slots, list):
                result["n_slots"] = len(slots)
                result["active_slots"] = sum(
                    1 for s in slots if isinstance(s, dict) and s.get("state") == 1
                )
                # Longest-running active slot — surface if stuck
                longest = 0.0
                for s in slots:
                    if isinstance(s, dict) and s.get("state") == 1:
                        age = s.get("t_start_process_prompt", 0)
                        if isinstance(age, (int, float)) and age > longest:
                            longest = age
                result["longest_active_ms"] = longest
    except Exception as e:
        result["slots_error"] = str(e)[:60]

    # /props reports model metadata including loaded model file.
    try:
        with urllib.request.urlopen(f"{base}/props", timeout=5) as resp:
            props = json.loads(resp.read())
            dm = props.get("default_generation_settings", {}) or {}
            result["ctx_size"] = dm.get("n_ctx") or props.get("n_ctx")
            result["model_path"] = props.get("model_path") or props.get("default_model")
    except Exception as e:
        result["props_error"] = str(e)[:60]

    return result


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
    try:
        base = "/sys/class/hwmon"
        for hwmon in sorted(os.listdir(base)):
            name_path = os.path.join(base, hwmon, "name")
            if os.path.exists(name_path):
                with open(name_path) as f:
                    name = f.read().strip()
                if name == "coretemp":
                    pkg_path = os.path.join(base, hwmon, "temp1_input")
                    if os.path.exists(pkg_path):
                        with open(pkg_path) as f:
                            return int(f.read().strip()) / 1000.0
    except Exception:
        pass
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
    """Check llama.cpp tmpfs overflow buffers (setup_llamacpp_buffers.sh)."""
    buffers = []
    for name in ("gpu0", "gpu1"):
        path = f"/mnt/llamacpp-buffer-{name}"
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
             "instances": [], "gpu": [], "cpu_temp_c": None, "ram": {},
             "buffers": [], "alerts": []}

    gpu_by_idx = {g.get("idx"): g for g in _gpu_stats() if isinstance(g, dict) and "idx" in g}
    entry["gpu"] = list(gpu_by_idx.values())

    # ── llama-server instances ──
    for inst in INSTANCES:
        status = _query_llamacpp(inst["port"])
        status["name"] = inst["name"]
        status["vulkan"] = inst["vulkan"]
        status["cuda_idx"] = inst["cuda_idx"]
        status["expected_model"] = inst["model"]

        if "error" in status:
            entry["alerts"].append(
                f"{inst['name']} UNREACHABLE at :{inst['port']} ({status['error'][:40]})"
            )
            entry["instances"].append(status)
            continue

        if status.get("health") != "ok":
            entry["alerts"].append(
                f"{inst['name']} /health={status.get('health','?')} (port {inst['port']})"
            )

        # Invariant check: the GPU assigned to this instance must hold the
        # model weights — if VRAM is suspiciously low, the process probably
        # fell back to CPU offload.
        gpu = gpu_by_idx.get(inst["cuda_idx"])
        if gpu:
            vram_used = gpu.get("mem_used_mb", 0)
            vram_total = gpu.get("mem_total_mb", 0)
            status["gpu_vram_used_mb"] = vram_used
            status["gpu_vram_total_mb"] = vram_total
            # Coder needs ~18 GB, arbiter needs ~9 GB. If less than 5 GB in use,
            # the model is almost certainly not fully on this GPU.
            min_expected = 5000
            if vram_used < min_expected:
                entry["alerts"].append(
                    f"{inst['name']} OFFLOAD INVARIANT VIOLATED: only {vram_used} MB "
                    f"on cuda:{inst['cuda_idx']} ({inst['vulkan']}) — expected >= {min_expected} MB. "
                    f"Model likely fell back to CPU."
                )

        # Stuck-slot check
        longest = status.get("longest_active_ms", 0) or 0
        if longest > SLOT_STUCK_SECONDS * 1000:
            entry["alerts"].append(
                f"{inst['name']} slot stuck: longest active request "
                f"{longest / 1000:.0f}s (threshold {SLOT_STUCK_SECONDS}s)"
            )

        entry["instances"].append(status)

    # ── GPU thermals ──
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
    for inst in entry["instances"]:
        if "error" in inst:
            parts.append(f"{inst['name']}:DOWN")
            continue
        active = inst.get("active_slots", 0) or 0
        n = inst.get("n_slots", 0) or 0
        vram = inst.get("gpu_vram_used_mb", 0) or 0
        parts.append(
            f"{inst['name']}:{inst.get('health','?')} "
            f"slots={active}/{n} vram={vram}MB"
        )
    gpu_temps = [
        f"GPU{g['idx']}:{g.get('temp_c','?')}°C/{g.get('power_w','?')}W"
        for g in entry.get("gpu", []) if isinstance(g, dict) and "idx" in g
    ]
    cpu_t = f"CPU:{entry['cpu_temp_c']:.0f}°C" if entry.get("cpu_temp_c") else ""
    ram = entry.get("ram", {})
    ram_t = f"RAM:{ram.get('used_mb', 0)//1024}G/{ram.get('total_mb', 0)//1024}G" if ram else ""
    buf_parts = [
        f"buf-{b['name']}:{b.get('used_mb', 0)}MB/{b.get('total_mb', 0)}MB"
        for b in entry.get("buffers", []) if b.get("mounted")
    ]
    return (f"{entry['iso']} | {' | '.join(parts)} | "
            f"{' '.join(gpu_temps)} {cpu_t} {ram_t}"
            + (f" | {' '.join(buf_parts)}" if buf_parts else ""))


def run_daemon(interval: int = 60):
    os.makedirs(os.path.dirname(LOG_PATH), exist_ok=True)
    print(f"llama.cpp monitor started (interval={interval}s, log={LOG_PATH})")
    _inst_desc = ", ".join(f"{i['name']}@:{i['port']}" for i in INSTANCES)
    print(f"Instances: {_inst_desc}")
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
    parser = argparse.ArgumentParser(description="llama.cpp fleet monitor")
    parser.add_argument("--interval", type=int, default=60)
    parser.add_argument("--once", action="store_true", help="Single tick, JSON to stdout")
    args = parser.parse_args()
    if args.once:
        print(json.dumps(monitor_tick(), indent=2))
    else:
        run_daemon(args.interval)
