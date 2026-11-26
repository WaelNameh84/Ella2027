import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from wan22_worker import api_url, dimensions_for_ratio


def test_api_url_uses_existing_ella_queue():
    assert api_url("https://ella2027.onrender.com/", "/claim") == "https://ella2027.onrender.com/api/kaggle-wan22-worker/claim"


def test_supported_aspect_ratios():
    assert dimensions_for_ratio("16:9") == (832, 480)
    assert dimensions_for_ratio("9:16") == (480, 832)
    assert dimensions_for_ratio("1:1") == (640, 640)
