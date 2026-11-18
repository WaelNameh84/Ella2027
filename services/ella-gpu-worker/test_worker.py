import os, sys
os.environ.setdefault('WORKER_API_TOKEN','test-token')
os.environ.setdefault('COMFYUI_WORKFLOW','/tmp/ella-nonexistent-workflow.json')
sys.path.insert(0, os.path.dirname(__file__))
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
