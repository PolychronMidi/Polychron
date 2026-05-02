"""check_pipeline -- direct read of log/pipeline.log to report status.

Extracted from digest.py. Stateful: holds _check_pipeline_blocked across
calls so that once IN PROGRESS is returned for a run, all subsequent calls
in the same Python process get the BLOCKED message until the pipeline
actually completes (the "do other work, don't poll" reminder).
"""
import logging
import os
import re as _re
import time as _time

from server import context as ctx

logger = logging.getLogger("HME")

_check_pipeline_blocked: bool = False  # True after first IN PROGRESS; cleared on finish/fail


def check_pipeline() -> str:
    """Check current pipeline status by reading pipeline.log directly.
    Reports: IN PROGRESS (pipeline currently running), the finished line
    (pipeline completed), or FAILED with last 30 lines for diagnosis.
    This is the ONLY permitted way to check pipeline state -- never tail/cat the log.
    ONE CALL PER RUN: once IN PROGRESS is returned, all subsequent calls are blocked
    until the pipeline actually completes. The task notification fires on completion --
    that is your signal. Do not poll."""
    global _check_pipeline_blocked

    log_path = os.path.join(ctx.PROJECT_ROOT, "log", "pipeline.log")
    if not os.path.isfile(log_path):
        return "No pipeline.log found -- pipeline has not been run yet."
    try:
        with open(log_path, encoding="utf-8", errors="ignore") as f:
            lines = f.readlines()
    except Exception as e:
        return f"Could not read pipeline.log: {e}"

    if not lines:
        return "pipeline.log is empty."

    stripped = [l.rstrip() for l in lines if l.strip()]
    last30 = "\n".join(stripped[-30:])
    last10 = stripped[-10:] if len(stripped) >= 10 else stripped

    finished = next((l for l in reversed(last10) if "Pipeline finished" in l), None)
    if finished:
        _check_pipeline_blocked = False
        return f"Pipeline: {finished.strip()}"

    last5 = stripped[-5:] if len(stripped) >= 5 else stripped
    in_progress_line = next((l for l in reversed(last5) if l.startswith("script in progress")), None)
    if in_progress_line:
        if _check_pipeline_blocked:
            return (
                "BLOCKED: check_pipeline already returned IN PROGRESS for this run. "
                "Calling it again proves you are polling -- burning context window on a status "
                "you already have, instead of doing actual work. Every redundant call is dead "
                "context that can never be recovered. The task notification fires when the "
                "pipeline finishes. Until then: implement the next evolution, run "
                "what_did_i_forget, explore with coupling_intel or module_intel. "
                "Polling is not waiting -- it is active waste."
            )
        step_match = _re.search(r"script in progress[:\s]+(.+)", in_progress_line)
        step_name = step_match.group(1).strip() if step_match else "unknown step"
        try:
            log_age_s = _time.time() - os.path.getmtime(log_path)
            result = f"Pipeline: IN PROGRESS -- `{step_name}` (log updated {log_age_s:.0f}s ago)"
        except Exception as _err:
            logger.debug(f"unnamed-except digest_pipeline_status.py: {type(_err).__name__}: {_err}")
            result = f"Pipeline: IN PROGRESS -- `{step_name}`"
        _check_pipeline_blocked = True
        return result

    # Race-condition guard: between steps
    try:
        log_mtime = os.path.getmtime(log_path)
        log_age_s = _time.time() - log_mtime
        last3 = stripped[-3:] if len(stripped) >= 3 else stripped
        last3_text = " ".join(last3)
        if log_age_s < 90 and "error" not in last3_text.lower():
            if _check_pipeline_blocked:
                return (
                    "STOP POLLING. Pipeline is still running -- you already know this. "
                    "check_pipeline is blocked for the rest of this run. "
                    "The task notification fires on completion. Do other work."
                )
            last_step = "between steps"
            for l in reversed(stripped[-20:]):
                step_m = _re.search(r"script in progress[:\s]+(.+)", l)
                if step_m:
                    last_step = f"after `{step_m.group(1).strip()}`"
                    break
            _check_pipeline_blocked = True
            return f"Pipeline: IN PROGRESS ({last_step} -- log modified {log_age_s:.0f}s ago)"
    except Exception as _err1:
        logger.debug(f'silent-except digest_pipeline_status.py: {type(_err1).__name__}: {_err1}')

    _check_pipeline_blocked = False
    return f"Pipeline: FAILED\n\nLast 30 lines:\n{last30}"
