import sys
import threading
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from server.tools_analysis.evolution import index_jobs


def test_start_index_job_returns_immediately(tmp_path):
    started = threading.Event()
    release = threading.Event()

    def runner(action):
        started.set()
        assert action == "index"
        release.wait(2)
        return "index ok"

    t0 = time.monotonic()
    status = index_jobs.start_index_job(str(tmp_path), "index", runner=runner)
    elapsed = time.monotonic() - t0

    assert elapsed < 0.5
    assert status["state"] == "running"
    assert status["action"] == "index"
    assert status["just_started"] is True
    assert "started in background" in index_jobs.format_index_job(str(tmp_path), status)
    assert Path(status["status_path"]).exists()
    assert started.wait(1)

    running = index_jobs.read_index_job(str(tmp_path))
    assert "Index job running" in index_jobs.format_index_job(str(tmp_path), running)

    release.set()
    assert index_jobs.wait_for_current_job(2)
    final = index_jobs.read_index_job(str(tmp_path))
    assert final["state"] == "done"
    assert final["result"] == "index ok"


def test_start_index_job_reports_already_running(tmp_path):
    release = threading.Event()

    def runner(_action):
        release.wait(2)
        return "clear ok"

    first = index_jobs.start_index_job(str(tmp_path), "clear_index", runner=runner)
    second = index_jobs.start_index_job(str(tmp_path), "index", runner=lambda _a: "wrong")

    assert first["state"] == "running"
    assert second["already_running"] is True
    assert second["action"] == "clear_index"

    release.set()
    assert index_jobs.wait_for_current_job(2)
