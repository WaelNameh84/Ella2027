import unittest
from unittest.mock import patch
from translation import make_dialogue_bilingual

class TranslationTests(unittest.TestCase):
    @patch("translation.translate_line", return_value="Hello there")
    def test_arabic_dialogue_gets_english_translation(self, translate):
        rows, warnings = make_dialogue_bilingual(
            [{"text":"مرحبا","start":0,"end":2}], "ar", required=True
        )
        self.assertEqual(rows[0]["arabic"], "مرحبا")
        self.assertEqual(rows[0]["english"], "Hello there")
        self.assertEqual(warnings, [])
        translate.assert_called_once_with("مرحبا", "ar", "en")

    @patch("translation.translate_line", return_value="مرحبا")
    def test_english_dialogue_gets_arabic_translation(self, translate):
        rows, warnings = make_dialogue_bilingual(
            [{"text":"Hello","start":0,"end":2}], "en", required=True
        )
        self.assertEqual(rows[0]["english"], "Hello")
        self.assertEqual(rows[0]["arabic"], "مرحبا")
        self.assertEqual(warnings, [])

if __name__ == "__main__":
    unittest.main()
