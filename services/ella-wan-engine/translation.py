from __future__ import annotations
from functools import lru_cache
from typing import Any

def _normalise_language(value: str) -> str:
    value = (value or "ar").lower()
    return "en" if value.startswith("en") or "english" in value else "ar"

@lru_cache(maxsize=2048)
def translate_line(text: str, source: str, target: str) -> str:
    text = text.strip()
    if not text or source == target:
        return text
    try:
        from deep_translator import GoogleTranslator
    except ImportError as exc:
        raise RuntimeError("Auto-translation requires deep-translator. Install requirements-audio.txt.") from exc
    # GoogleTranslator is a no-key community integration; it requires internet
    # and can be rate-limited. Never silently label untranslated text as translated.
    result = GoogleTranslator(source=source, target=target).translate(text)
    if not result or not result.strip():
        raise RuntimeError(f"Translation returned empty text ({source}->{target}).")
    return result.strip()

def make_dialogue_bilingual(dialogue: list[dict[str, Any]], source_language: str,
                            required: bool = False) -> tuple[list[dict[str, Any]], list[str]]:
    source = _normalise_language(source_language)
    target = "en" if source == "ar" else "ar"
    output=[]; warnings=[]
    for index, raw in enumerate(dialogue):
        item=dict(raw)
        text=str(item.get("text") or "").strip()
        if not text:
            output.append(item); continue
        source_text = item.get("arabic") if source == "ar" else item.get("english")
        if source_text:
            text=str(source_text).strip()
        item["arabic" if source == "ar" else "english"] = text
        counterpart_key = "english" if source == "ar" else "arabic"
        if not str(item.get(counterpart_key) or "").strip():
            try:
                item[counterpart_key] = translate_line(text, source, target)
            except Exception as exc:
                message=f"Dialogue line {index+1} translation unavailable: {exc}"
                if required:
                    raise RuntimeError(message) from exc
                warnings.append(message)
        output.append(item)
    return output, warnings
