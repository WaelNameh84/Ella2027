import importlib.util
import tempfile
import unittest
from pathlib import Path

MODULE_PATH = Path(__file__).with_name("audio_postprocess.py")
SPEC = importlib.util.spec_from_file_location("ella_audio_postprocess", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)


class SubtitleTests(unittest.TestCase):
    def test_arabic_and_english_are_separated(self):
        dialogue = [
            {"language": "ar", "text": "مرحبا", "start": 0, "end": 1.5, "english": "Hello"},
            {"language": "en", "text": "Good morning", "start": 2, "end": 3, "arabic": "صباح الخير"},
        ]
        with tempfile.TemporaryDirectory() as tmp:
            ar = Path(tmp) / "ar.srt"
            en = Path(tmp) / "en.srt"
            MODULE.write_srt(dialogue, [], ar, "ar")
            MODULE.write_srt(dialogue, [], en, "en")
            self.assertIn("مرحبا", ar.read_text(encoding="utf-8"))
            self.assertIn("صباح الخير", ar.read_text(encoding="utf-8"))
            self.assertNotIn("Good morning", ar.read_text(encoding="utf-8"))
            self.assertIn("Hello", en.read_text(encoding="utf-8"))
            self.assertIn("Good morning", en.read_text(encoding="utf-8"))
            self.assertNotIn("مرحبا", en.read_text(encoding="utf-8"))

    def test_subtitle_only_lines_keep_selected_language(self):
        lines = [{"language": "en", "text": "A new day", "start": 0, "end": 2}]
        with tempfile.TemporaryDirectory() as tmp:
            ar = Path(tmp) / "ar.srt"
            en = Path(tmp) / "en.srt"
            MODULE.write_srt([], lines, ar, "ar")
            MODULE.write_srt([], lines, en, "en")
            self.assertEqual("", ar.read_text(encoding="utf-8"))
            self.assertIn("A new day", en.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
