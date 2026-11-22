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

        # LTX-Video is trained for 24 fps. Its temporal length must be 8n + 1.
        # seconds * 24 + 1 satisfies that alignment and preserves real-time motion.
        fps = 24
        frames = seconds * fps + 1
        width, height = 768, 512
        steps = 50

        scene_prompt = str(job.get("prompt") or "").strip()
        prompt = (
            scene_prompt
            + "\n\n"
            "Photorealistic live-action video. Show the described subject and "
            "objects clearly and completely. One continuous shot, one simple "
            "main action, realistic proportions, natural movement, stable "
            "geometry and consistent daylight. No visible text or graphic overlays."
        ).strip()

        negative_prompt = (
            "worst quality, low quality, blurry, smeared details, inconsistent "
            "motion, jitter, flicker, distorted anatomy, deformed faces, "
            "malformed hands, extra limbs, duplicated objects, warped geometry, "
            "text, letters, numbers, captions, subtitles, logos, watermark, "
            "random symbols"
        )

        print(
            f"[ELLA LTX CALLBACK V5] job={job.get('id', 'unknown')} "
            f"duration={seconds}s | resolution={width}x{height} | "
            f"frames={frames} | fps={fps} | steps={steps}",
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
            "-r", str(fps), "-c:v", "libx264", "-preset", "veryfast",
            "-crf", "18", "-pix_fmt", "yuv420p", "-an", str(output),
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
            f"Finished {output.name} | duration={seconds}s | fps={fps} | "
            f"resolution={width}x{height} | size={output.stat().st_size / 1024 / 1024:.1f} MiB",
            flush=True,
        )
        return output

    return generate_with_ltx
