"""Narrow VideoX-Fun's eager package exports to CogVideoX inference only.

The pinned upstream commit eagerly imports every model family from package
__init__.py files. These replacements change only package exports, not model,
attention, pipeline, scheduler, memory, or weight files.
"""
from __future__ import annotations

import subprocess
from pathlib import Path

UPSTREAM_COMMIT = "98fffa929bb373edcbfa3620e9aa05cd65a53103"

REPLACEMENTS = {
    "videox_fun/models/__init__.py": """from transformers import T5EncoderModel, T5Tokenizer\nfrom .cogvideox_transformer3d import CogVideoXTransformer3DModel\nfrom .cogvideox_vae import AutoencoderKLCogVideoX\n""",
    "videox_fun/pipeline/__init__.py": """from .pipeline_cogvideox_fun import CogVideoXFunPipeline\nfrom .pipeline_cogvideox_fun_inpaint import CogVideoXFunInpaintPipeline\n""",
    "videox_fun/utils/__init__.py": """from .gpu_memory_mode import apply_gpu_memory_mode\nfrom .utils import get_image_to_video_latent, save_videos_grid\n""",
    "videox_fun/dist/__init__.py": """from .fuser import (get_sequence_parallel_rank, get_sequence_parallel_world_size,\n                   get_sp_group, xFuserLongContextAttention)\nfrom .cogvideox_xfuser import CogVideoXMultiGPUsAttnProcessor2_0\n""",
}


def prepare(repo: str | Path, require_pinned_commit: bool = True) -> list[Path]:
    root = Path(repo).resolve()
    if not (root / "videox_fun").is_dir():
        raise FileNotFoundError(f"VideoX-Fun source tree not found: {root}")
    if require_pinned_commit:
        commit = subprocess.check_output(["git", "-C", str(root), "rev-parse", "HEAD"], text=True).strip()
        if commit != UPSTREAM_COMMIT:
            raise RuntimeError(f"Unexpected VideoX-Fun revision {commit}; expected {UPSTREAM_COMMIT}")
    changed: list[Path] = []
    for relative, content in REPLACEMENTS.items():
        target = root / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
        changed.append(target)
    return changed


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("repo", type=Path)
    parser.add_argument("--allow-other-commit", action="store_true")
    args = parser.parse_args()
    files = prepare(args.repo, require_pinned_commit=not args.allow_other_commit)
    print("Prepared minimal CogVideoX imports:", *(str(path) for path in files), sep="\n- ")
