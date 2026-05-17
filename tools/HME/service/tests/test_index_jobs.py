import importlib.util
import sys
import threading
import time
from pathlib import Path


def _load_index_jobs():
    path = (Path(__file__).resolve().parent.parent
            / "server" / "tools_analysis" / "evolution" / "index_jobs.py")
    spec = importlib.util.spec_from_file_location("test_index_jobs_module", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


index_jobs = _load_index_jobs()


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

def test_read_index_job_marks_orphaned_running_job_stale(tmp_path):
    status_path, _log_path = index_jobs._paths(str(tmp_path))
    Path(status_path).parent.mkdir(parents=True, exist_ok=True)
    Path(status_path).write_text('{\n  "state": "running",\n  "action": "index",\n  "started_at": "2000-01-01T00:00:00Z",\n  "updated_at": "2000-01-01T00:00:00Z",\n  "pid": 99999999\n}\n')

    status = index_jobs.read_index_job(str(tmp_path))

    assert status["state"] == "stale"
    assert status["live_in_process"] is False
    assert "no live worker thread" in status["error"]
    assert "Index job status" in index_jobs.format_index_job(str(tmp_path), status)



def test_index_job_utc_parser_is_timezone_safe():
    assert index_jobs._iso_to_epoch("1970-01-01T00:00:00Z") == 0.0

