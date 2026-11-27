from __future__ import annotations
import os, shutil, subprocess, sys, tempfile
from pathlib import Path

def _run(command: list[str], label: str, cwd: Path | None = None) -> str:
    result=subprocess.run(command,cwd=str(cwd) if cwd else None,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
    if result.returncode:
        raise RuntimeError(f"{label} failed: {result.stdout[-3000:]}")
    return result.stdout

def make_dialogue_audio(speech: list[tuple[Path,float]], duration: float, output: Path) -> Path | None:
    if not speech: return None
    cmd=["ffmpeg","-y"]
    for path,_ in speech: cmd += ["-i",str(path)]
    filters=[]; labels=[]
    for i,(_,start) in enumerate(speech):
        label=f"d{i}"; delay=round(max(0,start)*1000)
        filters.append(f"[{i}:a]adelay={delay}|{delay},aresample=48000,apad[{label}]")
        labels.append(f"[{label}]")
    filters.append("".join(labels)+f"amix=inputs={len(labels)}:duration=longest,atrim=0:{duration:.3f},volume=1.0[out]")
    cmd += ["-filter_complex",";".join(filters),"-map","[out]","-c:a","pcm_s16le",str(output)]
    _run(cmd,"dialogue timeline")
    return output

def apply_musetalk(video: Path, audio: Path, output: Path, home: Path) -> dict:
    script=home/"scripts"/"inference.py"
    model=home/"models"/"musetalkV15"/"unet.pth"
    config=home/"models"/"musetalkV15"/"musetalk.json"
    required=[
        script,model,config,home/"models"/"sd-vae"/"config.json",
        home/"models"/"whisper"/"config.json",
        home/"models"/"dwpose"/"dw-ll_ucoco_384.pth",
        home/"models"/"face-parse-bisent"/"79999_iter.pth",
        home/"models"/"face-parse-bisent"/"resnet18-5c106cde.pth",
    ]
    missing=[str(p) for p in required if not p.is_file()]
    if missing: raise RuntimeError("MuseTalk 1.5 model files missing: "+", ".join(missing))
    try:
        import yaml
    except ImportError as exc:
        raise RuntimeError("MuseTalk requires PyYAML.") from exc
    output.parent.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="ella_musetalk_") as tmp:
        tmp=Path(tmp); cfg=tmp/"inference.yaml"; result_dir=tmp/"results"
        cfg.write_text(yaml.safe_dump({"task_0":{"video_path":str(video),"audio_path":str(audio),"bbox_shift":-7}},sort_keys=False),encoding="utf-8")
        musetalk_python=os.getenv("ELLA_MUSETALK_PYTHON",sys.executable)
        command=[
            musetalk_python,"-m","scripts.inference","--inference_config",str(cfg),
            "--result_dir",str(result_dir),"--unet_model_path",str(model),
            "--unet_config",str(config),"--version","v15","--use_float16",
            "--ffmpeg_path",shutil.which("ffmpeg") or "ffmpeg",
        ]
        _run(command,"MuseTalk lip synchronization",cwd=home)
        candidates=sorted(result_dir.rglob("*.mp4"),key=lambda p:p.stat().st_mtime,reverse=True)
        if not candidates: raise RuntimeError("MuseTalk finished without an MP4 result.")
        # MuseTalk writes its driving audio into the result; ELLA remixes dialogue,
        # music and ambience itself, so keep only the synchronized video stream.
        _run(["ffmpeg","-y","-i",str(candidates[0]),"-map","0:v:0","-an","-c:v","copy","-movflags","+faststart",str(output)],"MuseTalk silent video export")
    return {"model":"MuseTalk 1.5","output":str(output)}

def apply_realesrgan(video: Path, output: Path, fps: int, home: Path, scale: int=2) -> dict:
    inference=home/"inference_realesrgan.py"
    weights=home/"weights"/"RealESRGAN_x4plus.pth"
    if not inference.is_file() or not weights.is_file():
        raise RuntimeError("Real-ESRGAN is not installed. Run the ELLA optional-model setup cell.")
    output.parent.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="ella_esrgan_") as tmp:
        tmp=Path(tmp); frames=tmp/"frames"; restored=tmp/"restored"
        frames.mkdir(); restored.mkdir()
        _run(["ffmpeg","-y","-i",str(video),"-vsync","0",str(frames/"frame_%06d.png")],"video frame extraction")
        realesrgan_python=os.getenv("ELLA_REALESRGAN_PYTHON",sys.executable)
        _run([
            realesrgan_python,str(inference),"-n","RealESRGAN_x4plus","-i",str(frames),
            "-o",str(restored),"--outscale",str(scale),"--tile","256",
            "--model_path",str(weights),
        ],"Real-ESRGAN upscaling")
        first=restored/"frame_000001_out.png"
        if not first.is_file():
            raise RuntimeError("Real-ESRGAN did not produce the expected upscaled frames.")
        silent=tmp/"upscaled.mp4"
        _run(["ffmpeg","-y","-framerate",str(fps),"-i",str(restored/"frame_%06d_out.png"),
              "-i",str(video),"-map","0:v:0","-map","1:a?","-c:v","libx264","-preset","veryfast",
              "-crf","18","-pix_fmt","yuv420p","-c:a","copy","-shortest","-movflags","+faststart",str(silent)],
             "upscaled video encoding")
        shutil.copy2(silent,output)
    return {"model":"Real-ESRGAN x4plus","scale":scale,"output":str(output)}
