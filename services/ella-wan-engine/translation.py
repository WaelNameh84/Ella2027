from __future__ import annotations
from functools import lru_cache
from typing import Any

def _normalise_language(value: str) -> str:
    value = (value or "ar").lower()
    return "en" if value.startswith("en") or "english" in value else "ar"

@lru_cache(maxsize=2)
def _load_translation_pair(source: str, target: str):
    try:
        import argostranslate.package
        import argostranslate.translate
    except ImportError as exc:
        raise RuntimeError("Offline translation requires argostranslate. Install requirements-audio.txt.") from exc
    argostranslate.package.update_package_index()
    installed = argostranslate.translate.get_installed_languages()
    source_language = next((lang for lang in installed if lang.code == source), None)
    target_language = next((lang for lang in installed if lang.code == target), None)
    if source_language and target_language:
        existing = next((t for t in source_language.translations if t.to_lang.code == target), None)
        if existing:
            return existing
    available = argostranslate.package.get_available_packages()
    package = next((p for p in available if p.from_code == source and p.to_code == target), None)
    if package is None:
        raise RuntimeError(f"No offline Argos model is published for {source}->{target}.")
    downloaded = package.download()
    argostranslate.package.install_from_path(downloaded)
    installed = argostranslate.translate.get_installed_languages()
    source_language = next(lang for lang in installed if lang.code == source)
    translation = next((t for t in source_language.translations if t.to_lang.code == target), None)
    if translation is None:
        raise RuntimeError(f"Argos model installation did not register {source}->{target}.")
    return translation

@lru_cache(maxsize=2048)
def translate_line(text: str, source: str, target: str) -> str:
    text = text.strip()
    if not text or source == target:
        return text
    # Argos runs locally. Only the language model package is downloaded;
    # dialogue text itself is never sent to a translation API.
    translated = _load_translation_pair(source, target).translate(text)
    if not translated or not translated.strip():
        raise RuntimeError(f"Offline translation returned empty text ({source}->{target}).")
    return translated.strip()

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
