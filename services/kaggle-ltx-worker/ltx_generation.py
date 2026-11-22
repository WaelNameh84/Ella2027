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

        fps = 8
        # LTX temporal alignment: 8n+1 frames.
        frames = seconds * fps + 1
        width, height = 768, 448
        steps = 24
        prompt = str(job.get("prompt") or "One coherent cinematic shot, realistic natural movement.")
        negative_prompt = (
            "blurry, low detail, smeared textures, distorted faces, extra limbs, "
            "flicker, jitter, unstable motion, artifacts, watermark, subtitles, text"
        )

        print(
            f"[ELLA LTX CALLBACK V2] job={job.get('id', 'unknown')} "
            f"received_duration={requested!r} | "
            f"Generating requested duration={seconds}s | "
            f"native={width}x{height} | frames={frames} | steps={steps}"
        )
        result = pipe(
            prompt=prompt,
            negative_prompt=negative_prompt,
            width=width,
            height=height,
            num_frames=frames,
            num_inference_steps=steps,
            guidance_scale=5.0,
        )

        job_id = str(job.get("id", "video"))
        raw = Path("/kaggle/working") / f"ella_{job_id}_raw.mp4"
        output = Path("/kaggle/working") / f"ella_{job_id}.mp4"
        export_to_video(result.frames[0], str(raw), fps=fps)

        # Trim the extra temporal-alignment frame so delivered duration matches the request.
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
            f"native resolution={width}x{height} | "
            f"size={output.stat().st_size / 1024 / 1024:.1f} MiB"
        )
        return output

    return generate_with_ltx
