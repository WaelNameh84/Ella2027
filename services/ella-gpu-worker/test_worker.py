import os
import tempfile
from pathlib import Path

os.environ["WORKER_DATA_DIR"] = tempfile.mkdtemp()
os.environ["WORKER_DB_PATH"] = str(Path(os.environ["WORKER_DATA_DIR"]) / "test.sqlite3")
os.environ["COMFYUI_WORKFLOW_PATH"] = str(Path(os.environ["WORKER_DATA_DIR"]) / "missing.json")
os.environ["ELLA_WORKER_TOKEN"] = "test-token"

from fastapi.testclient import TestClient
from app.main import app, connection

client = TestClient(app)


def test_health_reports_missing_workflow_not_ready():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["generation_ready"] is False


def test_capabilities_requires_token():
    assert client.get("/v1/capabilities").status_code == 401
    response = client.get("/v1/capabilities", headers={"Authorization": "Bearer test-token"})
    assert response.status_code == 200
    assert response.json()["persistent_jobs"] is True


def test_generation_fails_closed_without_workflow():
    response = client.post("/v1/videos", headers={"Authorization": "Bearer test-token"},
                           json={"prompt": "A cinematic test scene"})
    assert response.status_code == 503


def test_jobs_are_persisted_in_sqlite():
    with connection() as conn:
        conn.execute("INSERT INTO jobs(id,status,prompt,created_at,updated_at) VALUES(?,?,?,?,?)",
                     ("persist-test", "queued", "test prompt", 1.0, 1.0))
    with connection() as conn:
        row = conn.execute("SELECT status FROM jobs WHERE id=?", ("persist-test",)).fetchone()
    assert row["status"] == "queued"
