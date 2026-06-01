"""InstanceSpec dataclass + default topology factory.

Declarative launch plan for one llama-server instance. Each LLM owns its
GPU end-to-end. ARCHITECTURE INVARIANT: n_gpu_layers is always 999 (full
offload). Any partial-offload scenario fires a CRITICAL LIFESAVER and
refuses to spawn.

Vulkan device indices: Vulkan0 = Intel iGPU, Vulkan1 = M40 #1 (CUDA 0),
Vulkan2 = M40 #2 (CUDA 1).
"""
from __future__ import annotations

import subprocess
from dataclasses import dataclass, field

from ._boot import ENV


@dataclass
class InstanceSpec:
    """Declarative launch plan for one llama-server instance."""
    name: str
    model_path: str
    port: int
    device: str           # Vulkan device string, e.g. "Vulkan1" / "Vulkan2"
    alias: str            # llama-server --alias (the model name clients use)
    ctx_size: int = 4096
    n_gpu_layers: int = 999   # HME invariant: full offload only
    timeout_s: int = 30
    lora_path: str | None = None
    extra_args: list[str] = field(default_factory=list)
    # Runtime state
    process: subprocess.Popen | None = None
    last_start: float = 0.0
    restart_count: int = 0
    last_health_ok: float = 0.0
    suspended: bool = False  # when True, supervisor won't auto-restart this instance

    def base_url(self) -> str:
        return f"http://127.0.0.1:{self.port}"

    def build_argv(self, bin_path: str) -> list[str]:
        argv = [
            bin_path,
            "--model", self.model_path,
            "--host", "127.0.0.1",
            "--port", str(self.port),
            "--ctx-size", str(self.ctx_size),
            "--n-gpu-layers", str(self.n_gpu_layers),
            "--device", self.device,
            "--alias", self.alias,
            "--timeout", str(self.timeout_s),
            "--jinja",
        ]
        if self.lora_path:
            argv.extend(["--lora", self.lora_path])
        argv.extend(self.extra_args)
        return argv


def _default_instances() -> list[InstanceSpec]:
    """Default arbiter+coder topology from .env."""
    arbiter_model = ENV.require("HME_ARBITER")
    coder_model   = ENV.require("HME_CODER")
    return [
        InstanceSpec(
            name="arbiter",
            model_path=arbiter_model,
            port=ENV.require_int("HME_ARBITER_PORT"),
            device=ENV.require("HME_ARBITER_VULKAN"),
            alias=ENV.require("HME_ARBITER_MODEL"),
            ctx_size=ENV.require_int("HME_ARBITER_CTX"),
            timeout_s=ENV.optional_int("HME_ARBITER_TIMEOUT", 120),
            n_gpu_layers=999,  # invariant
        ),
        InstanceSpec(
            name="coder",
            model_path=coder_model,
            port=ENV.require_int("HME_CODER_PORT"),
            device=ENV.require("HME_CODER_VULKAN"),
            alias=ENV.require("HME_CODER_ALIAS"),
            ctx_size=ENV.require_int("HME_CODER_CTX"),
            n_gpu_layers=999,  # invariant
        ),
    ]
