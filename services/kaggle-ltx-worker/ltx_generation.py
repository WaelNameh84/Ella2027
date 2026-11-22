"""LTX generation callback for the Ella2027 Kaggle worker.

Uses the already-loaded Diffusers pipeline; does not download or reload model weights.
"""
from pathlib import Path
import subprocess

from diffusers.utils import export_to_video


def make_ltx_generator(pipe):
    def generate_with_ltx(job):
        requested = job.get("durationSeconds", 5)
        try:
            seconds = int(requested)
        except (TypeError, ValueError):
            seconds = 5
        seconds = min(max(seconds, 1), 10)

        # Keep the 8 fps frame-count contract so requested duration remains exact.
        # LTX temporal alignment requires 8n + 1 frames.
        fps = 8
        frames = seconds * fps + 1

        # Use the model's standard 16:10 working resolution and quality-oriented
        # denoising/decoder settings documented for LTX-Video.
        width, height = 768, 512
        steps = 50

        scene_prompt = str(job.get("prompt") or "").strip()
        prompt = (
            scene_prompt
            + "\n\n"
            "Photorealistic natural live-action scene, one continuous shot, "
            "one clear main action, realistic anatomy and object proportions, "
            "coherent movement, stable scene geometry, natural lighting. "
            "No visible writing, letters, numbers, logos, subtitles, or graphic overlays."
        ).strip()

        negative_prompt = (
            "worst quality, low quality, blurry, smeared details, "
            "inconsistent motion, jittery motion, flicker, distorted anatomy, "
            "deformed faces, malformed hands, extra limbs, duplicated objects, "
            "warped geometry, text, letters, numbers, captions, subtitles, "
            "logos, watermark, random symbols"
        )

        print(
            f"[ELLA LTX CALLBACK V4] job={job.get('id', 'unknown')} "
            f"duration={seconds}s | resolution={width}x{height} | "
            f"frames={frames} | fps={fps} | steps={steps} | "
            "vae_decode_tuning=enabled",
            flush=True,
        )

        result = pipe(
            prompt=prompt,
            negative_prompt=negative_prompt,
            width=width,
            height=height,
            num_frames=frames,
            num_inference_steps=steps,
            guidance_scale=5.0,
            decode_timestep=0.03,
            decode_noise_scale=0.025,
        )

        job_id = str(job.get("id", "video"))
        raw = Path("/kaggle/working") / f"ella_{job_id}_raw.mp4"
        output = Path("/kaggle/working") / f"ella_{job_id}.mp4"
        export_to_video(result.frames[0], str(raw), fps=fps)

        command = [
            "ffmpeg", "-y", "-i", str(raw), "-t", str(seconds),
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
            "-pix_fmt", "yuv420p", "-an", str(output),
        ]
        completed = subprocess.run(command, capture_output=True, text=True)
        if completed.returncode != 0:
            raise RuntimeError("FFmpeg failed: " + (completed.stderr or "")[-1600:])
        if not output.is_file() or output.stat().st_size == 0:
            raise RuntimeError("LTX did not produce a valid MP4.")

        try:
            raw.unlink()
        except OSError:
            pass

        print(
            f"Finished {output.name} | duration={seconds}s | "
            f"native resolution={width}x{height} | steps={steps} | "
            f"size={output.stat().st_size / 1024 / 1024:.1f} MiB",
            flush=True,
        )
        return output

    return generate_with_ltx
