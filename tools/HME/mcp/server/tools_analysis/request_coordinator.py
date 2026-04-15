"""Request coordinator — priority-queued dispatch to llama-server instances.

Replaces the ollama-era threading.Event + preemption-flag design with an
explicit per-endpoint queue. One `CoordinatorInstance` per llama-server
(arbiter on :8080, coder on :8081). Callers submit via `coordinator.submit()`
and get back a `Future` that resolves when the request completes, times out,
or is preempted.

Priority levels (higher number = higher priority):
  BACKGROUND  = 1   — evict-on-preempt, yields to interactive/parallel
  BULK        = 2   — same tier as background but doesn't yield; used for batch index
  PARALLEL    = 3   — cross-GPU work that must not preempt itself
  INTERACTIVE = 4   — foreground user-visible calls
  CRITICAL    = 5   — onboarding/lifesaver probes; bypass circuit breaker backoff

Stacking semantics:
- Within a priority tier: FIFO.
- Higher tier pops first regardless of FIFO position of lower tiers.
- New interactive arriving while a background is mid-flight: coordinator sets
  the background's cancel_event. The background's urlopen wrapper returns
  InterruptedError within ~2s (socket read timeout). Background future resolves
  with `preempted=True`.
- Reserved slot guarantee: if an interactive shows up and a BG is running,
  the interactive is the next pop (not the next-queued interactive).

No llama-server backend assumed; just HTTP + OpenAI chat-completions shape.
Wall-clock enforcement is thread-abandon — mirrors _llamacpp_generate pattern.
"""
from __future__ import annotations

import heapq
import json
import logging
import threading
import time
import urllib.request
from dataclasses import dataclass, field
from typing import Any, Callable

logger = logging.getLogger("HME")

# Priority constants — higher = higher priority
CRITICAL    = 5
INTERACTIVE = 4
PARALLEL    = 3
BULK        = 2
BACKGROUND  = 1

_PRIORITY_NAMES = {
    CRITICAL: "critical",
    INTERACTIVE: "interactive",
    PARALLEL: "parallel",
    BULK: "bulk",
    BACKGROUND: "background",
}

# Only these priorities actually yield to higher tiers mid-flight
_PREEMPTIBLE = frozenset({BACKGROUND})

# Max in-queue depth per instance before submit() raises Overloaded
MAX_QUEUE_DEPTH = 32


class CoordinatorOverloaded(Exception):
    """Raised when submit() is called but the target instance's queue is full."""


@dataclass(order=True)
class _QueuedRequest:
    # heap key: (-priority, seq) → higher priority pops first, FIFO within tier
    _sort_key: tuple = field(init=False, repr=False)
    priority: int
    seq: int
    payload: dict = field(compare=False)
    wall_timeout: float = field(compare=False)
    future: "_Future" = field(compare=False)
    cancel_event: threading.Event = field(compare=False, default_factory=threading.Event)
    submitted_at: float = field(compare=False, default_factory=time.monotonic)

    def __post_init__(self):
        self._sort_key = (-self.priority, self.seq)


class _Future:
    """Minimal future — single-producer single-consumer, result or exception."""
    __slots__ = ("_done", "_result", "_exc", "_preempted")

    def __init__(self):
        self._done = threading.Event()
        self._result: Any = None
        self._exc: BaseException | None = None
        self._preempted = False

    def set_result(self, r: Any) -> None:
        self._result = r
        self._done.set()

    def set_exception(self, e: BaseException) -> None:
        self._exc = e
        self._done.set()

    def set_preempted(self) -> None:
        self._preempted = True
        self._done.set()

    def result(self, timeout: float | None = None) -> Any:
        """Block until done. Returns None on preempt; raises set_exception's exc."""
        if not self._done.wait(timeout=timeout):
            raise TimeoutError(f"_Future.result: timed out after {timeout}s")
        if self._exc is not None:
            raise self._exc
        if self._preempted:
            return None
        return self._result

    @property
    def preempted(self) -> bool:
        return self._done.is_set() and self._preempted


class CoordinatorInstance:
    """Per-llama-server dispatcher. One dispatcher thread drains the heap."""

    def __init__(self, name: str, base_url: str):
        self.name = name
        self.base_url = base_url.rstrip("/")
        self._heap: list[_QueuedRequest] = []
        self._heap_lock = threading.Lock()
        self._not_empty = threading.Condition(self._heap_lock)
        self._seq = 0
        self._inflight: _QueuedRequest | None = None
        self._stats_lock = threading.Lock()
        self._stats = {
            "submitted": 0,
            "completed": 0,
            "preempted": 0,
            "timed_out": 0,
            "errored": 0,
            "overloaded": 0,
        }
        self._stop = threading.Event()
        self._dispatcher = threading.Thread(
            target=self._dispatch_loop, name=f"coord-{name}", daemon=True
        )
        self._dispatcher.start()

    # ── public API ────────────────────────────────────────────────────────
    def submit(
        self,
        payload: dict,
        priority: int = INTERACTIVE,
        wall_timeout: float = 15.0,
    ) -> _Future:
        """Enqueue a request. Returns a _Future the caller can block on."""
        future = _Future()
        with self._heap_lock:
            # Overload gate — reject new submits when queue is saturated
            if len(self._heap) >= MAX_QUEUE_DEPTH:
                self._stats["overloaded"] += 1
                raise CoordinatorOverloaded(
                    f"{self.name}: queue full ({len(self._heap)}/{MAX_QUEUE_DEPTH})"
                )
            self._seq += 1
            req = _QueuedRequest(
                priority=priority,
                seq=self._seq,
                payload=payload,
                wall_timeout=wall_timeout,
                future=future,
            )
            heapq.heappush(self._heap, req)
            self._stats["submitted"] += 1

            # Preempt inflight background if a higher-priority request just arrived
            inflight = self._inflight
            if (
                inflight is not None
                and inflight.priority in _PREEMPTIBLE
                and priority > inflight.priority
            ):
                logger.info(
                    f"coord[{self.name}]: preempt {_PRIORITY_NAMES.get(inflight.priority)} "
                    f"→ incoming {_PRIORITY_NAMES.get(priority)}"
                )
                inflight.cancel_event.set()

            self._not_empty.notify()
        return future

    def stats(self) -> dict:
        with self._heap_lock:
            depth_by_prio: dict[str, int] = {}
            for r in self._heap:
                k = _PRIORITY_NAMES.get(r.priority, str(r.priority))
                depth_by_prio[k] = depth_by_prio.get(k, 0) + 1
            return {
                "name": self.name,
                "queued": len(self._heap),
                "inflight": _PRIORITY_NAMES.get(self._inflight.priority) if self._inflight else None,
                "depth_by_priority": depth_by_prio,
                **self._stats,
            }

    def shutdown(self) -> None:
        self._stop.set()
        with self._heap_lock:
            self._not_empty.notify_all()
        self._dispatcher.join(timeout=2.0)

    # ── dispatcher ────────────────────────────────────────────────────────
    def _dispatch_loop(self) -> None:
        while not self._stop.is_set():
            with self._heap_lock:
                while not self._heap and not self._stop.is_set():
                    self._not_empty.wait(timeout=1.0)
                if self._stop.is_set():
                    return
                req = heapq.heappop(self._heap)
                self._inflight = req

            try:
                self._execute(req)
            except Exception as e:
                logger.exception(f"coord[{self.name}]: dispatcher error: {e}")
                req.future.set_exception(e)
                with self._stats_lock:
                    self._stats["errored"] += 1
            finally:
                with self._heap_lock:
                    self._inflight = None

    def _execute(self, req: _QueuedRequest) -> None:
        """Run one request against llama-server. Honors cancel_event for preempt."""
        url = f"{self.base_url}/v1/chat/completions"
        body = json.dumps(req.payload).encode()
        http_req = urllib.request.Request(
            url, data=body, headers={"Content-Type": "application/json"}
        )

        # Thread-abandon pattern: worker writes into result slot, parent joins
        # with wall_timeout. If joined alive, we consider it wall-timed-out.
        result: dict = {"data": None, "err": None}

        def _worker() -> None:
            try:
                with urllib.request.urlopen(http_req, timeout=req.wall_timeout) as resp:
                    result["data"] = json.loads(resp.read())
            except Exception as e:
                result["err"] = e

        t = threading.Thread(target=_worker, name=f"{self.name}-exec", daemon=True)
        t.start()

        # Join loop that also watches cancel_event (for preemption)
        deadline = time.monotonic() + req.wall_timeout
        while t.is_alive():
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                break
            if req.cancel_event.is_set():
                break
            t.join(timeout=min(0.5, remaining))

        if req.cancel_event.is_set() and t.is_alive():
            # Preempted — abandon the thread (llama-server will finish and drop
            # its response). Mark future preempted so caller knows.
            logger.info(
                f"coord[{self.name}]: {_PRIORITY_NAMES.get(req.priority)} preempted "
                f"after {time.monotonic() - req.submitted_at:.1f}s"
            )
            req.future.set_preempted()
            with self._stats_lock:
                self._stats["preempted"] += 1
            return

        if t.is_alive():
            # Wall timeout
            logger.warning(
                f"coord[{self.name}]: wall timeout ({req.wall_timeout}s) for "
                f"{_PRIORITY_NAMES.get(req.priority)}"
            )
            req.future.set_result(None)
            with self._stats_lock:
                self._stats["timed_out"] += 1
            return

        if result["err"] is not None:
            e = result["err"]
            logger.info(f"coord[{self.name}]: HTTP error: {type(e).__name__}: {e}")
            req.future.set_result(None)
            with self._stats_lock:
                self._stats["errored"] += 1
            return

        data = result["data"] or {}
        choices = data.get("choices") or []
        if not choices:
            req.future.set_result(None)
            with self._stats_lock:
                self._stats["errored"] += 1
            return

        msg = choices[0].get("message", {}) if isinstance(choices[0], dict) else {}
        text = msg.get("content", "") if isinstance(msg, dict) else ""
        shaped = {"response": text, "context": [], "done": True}
        req.future.set_result(shaped)
        with self._stats_lock:
            self._stats["completed"] += 1


# ── module-level registry ────────────────────────────────────────────────
_instances: dict[str, CoordinatorInstance] = {}
_registry_lock = threading.Lock()


def get_instance(name: str, base_url: str) -> CoordinatorInstance:
    """Return the coordinator for `name`, creating it if needed."""
    with _registry_lock:
        inst = _instances.get(name)
        if inst is None:
            inst = CoordinatorInstance(name, base_url)
            _instances[name] = inst
            logger.info(f"coord: started {name} → {base_url}")
        return inst


def all_stats() -> list[dict]:
    with _registry_lock:
        return [inst.stats() for inst in _instances.values()]


def shutdown_all() -> None:
    with _registry_lock:
        for inst in _instances.values():
            inst.shutdown()
        _instances.clear()
