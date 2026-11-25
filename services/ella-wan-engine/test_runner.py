import argparse
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).parent))
from runner import aligned_frames, build_command


def test_temporal_frame_alignment():
    assert aligned_frames(5, 8) == 41
    assert aligned_frames(8, 8) == 65
    assert aligned_frames(1, 8) == 9


def test_build_command_t2v(tmp_path):
    a = argparse.Namespace(
        sd_cli=Path("sd-cli"), diffusion_model=Path("model.gguf"),
        vae=Path("vae.safetensors"), text_encoder=Path("t5.gguf"),
        prompt="cinematic test", negative_prompt="bad", width=1280,
        height=704, duration=5, fps=8, steps=20, cfg_scale=5.0,
        flow_shift=5.0, seed=42, threads=4, frame_dir=tmp_path,
        image=None,
    )
    cmd = build_command(a)
    assert "-i" not in cmd
    assert cmd[cmd.index("--video-frames") + 1] == "41"
    assert "--vae-tiling" in cmd


def test_build_command_i2v(tmp_path):
    a = argparse.Namespace(
        sd_cli=Path("sd-cli"), diffusion_model=Path("model.gguf"),
        vae=Path("vae.safetensors"), text_encoder=Path("t5.gguf"),
        prompt="cinematic test", negative_prompt="bad", width=1280,
        height=704, duration=5, fps=8, steps=20, cfg_scale=5.0,
        flow_shift=5.0, seed=42, threads=4, frame_dir=tmp_path,
        image=Path("reference.png"),
    )
    cmd = build_command(a)
    assert cmd[cmd.index("-i") + 1] == "reference.png"
