import os, sys, base64
os.environ.setdefault('WORKER_API_TOKEN','test-token')
os.environ.setdefault('COMFYUI_WORKFLOW','/tmp/ella-nonexistent-workflow.json')
os.environ.setdefault('ELLA_DATA_DIR','/tmp/ella-worker-test-data')
sys.path.insert(0, os.path.dirname(__file__))
from app import main
from app.main import APP, configure_workflow, model_catalog
from fastapi.testclient import TestClient

client = TestClient(APP)

def test_health_requires_auth():
    assert client.get('/health').status_code == 401

def test_capabilities_requires_auth():
    assert client.get('/capabilities').status_code == 401

def test_video_requires_auth():
    assert client.post('/v1/videos', json={'prompt':'x'}).status_code == 401

def test_model_is_not_claimed_ready_without_workflow():
    assert next(iter(model_catalog(None).values()))['ready'] is False

def test_job_store_persists_metadata_and_mp4(tmp_path, monkeypatch):
    monkeypatch.setattr(main, 'DB_PATH', tmp_path / 'jobs.sqlite3')
    monkeypatch.setattr(main, 'OUTPUT_DIR', tmp_path / 'outputs')
    main.OUTPUT_DIR.mkdir()
    main.init_job_store()
    job_id = 'persist-test'
    payload = base64.b64encode(b'fake-mp4-bytes').decode('ascii')
    main.persist_job(job_id, {'status':'completed', 'progress':100, 'created_at':1, 'video_base64':payload})
    restored = main.load_job(job_id)
    assert restored['status'] == 'completed'
    assert restored['video_base64'] == payload
    assert main.list_jobs(10)[0]['job_id'] == job_id

def test_running_job_is_marked_interrupted_after_restart(tmp_path, monkeypatch):
    monkeypatch.setattr(main, 'DB_PATH', tmp_path / 'jobs.sqlite3')
    monkeypatch.setattr(main, 'OUTPUT_DIR', tmp_path / 'outputs')
    main.OUTPUT_DIR.mkdir()
    main.init_job_store()
    main.persist_job('restart-test', {'status':'running', 'progress':42, 'created_at':2})
    main.init_job_store()
    restored = main.load_job('restart-test')
    assert restored['status'] == 'interrupted'
    assert 'Retry this scene' in restored['error']
