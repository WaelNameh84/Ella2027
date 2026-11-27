import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from wan22_worker import api_url, check_api_response, dimensions_for_ratio, duration_chunks


class FakeResponse:
    def __init__(self, status_code):
        self.status_code = status_code

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")


def test_authentication_errors_explain_manual_token_setup():
    for status, message in (
        (401, "exact same value as"),
        (503, "not configured on the API server"),
    ):
        try:
            check_api_response(FakeResponse(status))
        except PermissionError as error:
            assert message in str(error)
        else:
            raise AssertionError(f"Expected authentication failure for HTTP {status}")


def test_api_url_uses_existing_ella_queue():
    assert api_url("https://ella2027.onrender.com/", "/claim") == "https://ella2027.onrender.com/api/kaggle-wan22-worker/claim"


def test_supported_aspect_ratios():
    assert dimensions_for_ratio("16:9") == (832, 480)
    assert dimensions_for_ratio("9:16") == (480, 832)
    assert dimensions_for_ratio("3:4") == (576, 768)
    assert dimensions_for_ratio("2:3") == (512, 768)
    assert dimensions_for_ratio("4:5") == (512, 640)
    assert dimensions_for_ratio("1:1") == (640, 640)



def test_requested_duration_is_preserved_in_safe_chunks():
    assert duration_chunks(1, 5) == [1]
    assert duration_chunks(5, 5) == [5]
    assert duration_chunks(12, 5) == [5, 5, 2]
    assert sum(duration_chunks(20, 5)) == 20
    assert len(duration_chunks(600, 5)) == 120
