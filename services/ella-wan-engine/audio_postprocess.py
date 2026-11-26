#!/usr/bin/env python3
"""ELLA post-production: bilingual speech, SRT subtitles, ambience/music and frame interpolation."""
from __future__ import annotations
import argparse, json, shutil, subprocess, sys, tempfile
from pathlib import Path
from typing import Any
import os
from translation import make_dialogue_bilingual
from quality_models import make_dialogue_audio, apply_musetalk, apply_realesrgan

VOICE_BY_LANGUAGE = {"ar": "ar-SA-HamedNeural", "en": "en-US-GuyNeural"}

def run_checked(command: list[str], label: str) -> str:
    result = subprocess.run(command, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    if result.returncode:
        raise RuntimeError(f"{label} failed ({result.returncode}): {result.stdout[-2500:]}")
    return result.stdout

def require_ffmpeg() -> None:
    if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
        raise RuntimeError("ELLA post-production requires ffmpeg and ffprobe on PATH.")

def probe_duration(path: Path) -> float:
    raw = run_checked(["ffprobe","-v","error","-show_entries","format=duration","-of","default=noprint_wrappers=1:nokey=1",str(path)], "ffprobe")
    return float(raw.strip())

def write_srt(dialogue: list[dict[str, Any]], subtitle_lines: list[dict[str, Any]], destination: Path, language: str) -> None:
    def stamp(seconds: float) -> str:
        ms=max(0,round(seconds*1000)); h,ms=divmod(ms,3600000); m,ms=divmod(ms,60000); s,ms=divmod(ms,1000)
        return f"{h:02}:{m:02}:{s:02},{ms:03}"
    blocks=[]
    entries = list(dialogue) + list(subtitle_lines)
    for item in entries:
        lang=str(item.get("language","ar")).lower()
        translated=item.get("arabic") if language=="ar" else item.get("english")
        if translated:
            text=str(translated).strip()
        elif lang==language:
            text=str(item.get("text","")).strip()
        else:
            continue
        if not text: continue
        start=float(item.get("start",0)); end=float(item.get("end",start+3))
        if end<=start: raise ValueError("Subtitle end must be after start.")
        blocks.append(f"{len(blocks)+1}\n{stamp(start)} --> {stamp(end)}\n{text}\n")
    destination.write_text("\n".join(blocks),encoding="utf-8")

def synthesize_dialogue(plan: dict[str, Any], work: Path) -> tuple[list[tuple[Path,float]],list[tuple[Path,float]]]:
    dialogue=plan.get("dialogue") or []
    if not dialogue: return [],[]
    if not shutil.which("edge-tts"):
        raise RuntimeError("Dialogue requested but edge-tts is not installed. Install requirements-audio.txt.")
    source=str(plan.get("language","ar")).lower()
    source="en" if source.startswith("en") or "english" in source else "ar"
    target="en" if source=="ar" else "ar"
    source_tracks=[]; translated_tracks=[]
    for i,item in enumerate(dialogue):
        original=str(item.get("text") or "").strip()
        if not original: continue
        source_text=str(item.get("arabic") if source=="ar" else item.get("english") or original).strip()
        target_text=str(item.get("english") if source=="ar" else item.get("arabic") or "").strip()
        start=max(0.0,float(item.get("start",0)))
        source_voice=str(item.get("voice") or VOICE_BY_LANGUAGE[source])
        source_path=work/f"dialogue_{i:03d}_{source}.mp3"
        run_checked(["edge-tts","--voice",source_voice,"--text",source_text,"--write-media",str(source_path)],f"{source} speech synthesis item {i+1}")
        source_tracks.append((source_path,start))
        if target_text:
            target_voice=VOICE_BY_LANGUAGE[target]
            target_path=work/f"dialogue_{i:03d}_{target}.mp3"
            run_checked(["edge-tts","--voice",target_voice,"--text",target_text,"--write-media",str(target_path)],f"{target} speech synthesis item {i+1}")
            translated_tracks.append((target_path,start))
    return source_tracks,translated_tracks

def build_audio_mix(video: Path, output: Path, plan: dict[str,Any], speech: list[tuple[Path,float]]) -> None:
    tracks: list[tuple[Path,float,float]] = [(path,start,1.0) for path,start in speech]
    for key, volume_key in (("ambience","ambience_volume"),("music","music_volume")):
        if plan.get(key):
            path=Path(str(plan[key]))
            if not path.is_file(): raise FileNotFoundError(f"Configured {key} asset not found: {path}")
            volume=max(0.0,min(1.0,float(plan.get(volume_key,1.0))))
            tracks.append((path,0.0,volume))
    for item in plan.get("sfx") or []:
        path=Path(str(item.get("path") or ""))
        if not path.is_file(): raise FileNotFoundError(f"Configured sound effect not found: {path}")
        volume=max(0.0,min(1.0,float(item.get("volume",plan.get("ambience_volume",1.0)))))
        tracks.append((path,max(0.0,float(item.get("start",0))),volume))
    if not tracks:
        shutil.copy2(video,output); return
    cmd=["ffmpeg","-y","-i",str(video)]
    for path,_,_ in tracks: cmd += ["-i",str(path)]
    filters=[]; labels=[]
    for idx,(_,start,volume) in enumerate(tracks,1):
        label=f"a{idx}"; delay=round(start*1000)
        filters.append(f"[{idx}:a]volume={volume:.3f},adelay={delay}|{delay},aresample=48000,apad[{label}]")
        labels.append(f"[{label}]")
    duration=probe_duration(video)
    filters.append("".join(labels)+f"amix=inputs={len(labels)}:duration=longest:dropout_transition=2,atrim=0:{duration:.3f},loudnorm=I=-16:TP=-1.5:LRA=11[aout]")
    cmd += ["-filter_complex",";".join(filters),"-map","0:v:0","-map","[aout]","-c:v","copy","-c:a","aac","-b:a","192k","-shortest","-movflags","+faststart",str(output)]
    run_checked(cmd,"audio mixing")

def postprocess(video: Path, output: Path, plan_path: Path) -> dict[str,Any]:
    require_ffmpeg()
    plan=json.loads(plan_path.read_text(encoding="utf-8"))
    if not isinstance(plan,dict): raise ValueError("Audio plan must be a JSON object.")
    source_language=str(plan.get("language","ar")).lower()
    translation_warnings=[]
    if plan.get("auto_translate",True):
        plan["dialogue"],translation_warnings=make_dialogue_bilingual(
            plan.get("dialogue") or [],source_language,required=bool(plan.get("translation_required",False)))
    output.parent.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="ella_post_") as tmp:
        work=Path(tmp); speech,alternate_speech=synthesize_dialogue(plan,work)
        duration=probe_duration(video)
        dialogue_audio=make_dialogue_audio(speech,duration,work/"dialogue_timeline.wav")
        alternate_audio=make_dialogue_audio(alternate_speech,duration,work/"dialogue_alternate_timeline.wav")
        video_for_mix=video
        lip_sync_info={"enabled":False,"reason":"disabled"}
        musetalk_home=os.getenv("ELLA_MUSETALK_HOME","").strip()
        if plan.get("lip_sync",True):
            if musetalk_home and dialogue_audio:
                lip_video=work/"musetalk_lipsynced.mp4"
                lip_sync_info=apply_musetalk(video,dialogue_audio,lip_video,Path(musetalk_home))
                video_for_mix=lip_video
            else:
                lip_sync_info={"enabled":False,"reason":"MuseTalk model bundle not configured or no dialogue audio"}
        mixed=work/"mixed.mp4"
        mix_speech=[(dialogue_audio,0.0)] if video_for_mix != video and dialogue_audio else speech
        build_audio_mix(video_for_mix,mixed,plan,mix_speech)
        source_fps=int(plan.get("source_fps",8)); final_fps=int(plan.get("final_fps",24))
        upscale_info={"enabled":False,"reason":"disabled"}
        realesrgan_home=os.getenv("ELLA_REALESRGAN_HOME","").strip()
        if plan.get("upscale",True):
            if realesrgan_home:
                upscaled=work/"upscaled.mp4"
                upscale_info=apply_realesrgan(mixed,upscaled,source_fps,Path(realesrgan_home),int(plan.get("upscale_factor",2)))
                mixed=upscaled
            else:
                upscale_info={"enabled":False,"reason":"Real-ESRGAN model bundle not configured"}
        if final_fps not in (8,12,16,24,30): raise ValueError("final_fps must be 8, 12, 16, 24 or 30.")
        filters=[]
        if plan.get("cinematic_color",True): filters.append("eq=contrast=1.04:saturation=1.04:brightness=0.005")
        if plan.get("interpolate",True) and final_fps>source_fps:
            filters.append(f"minterpolate=fps={final_fps}:mi_mode=mci:mc_mode=aobmc:vsbmc=1")
        elif final_fps!=source_fps: filters.append(f"fps={final_fps}")
        cmd=["ffmpeg","-y","-i",str(mixed)]
        if filters: cmd += ["-vf",",".join(filters)]
        sidecars=[]
        if alternate_audio:
            cmd += ["-i",str(alternate_audio)]
        if plan.get("subtitles",True):
            for lang in ("ar","en"):
                srt=output.with_name(output.stem+f".{lang}.srt")
                write_srt(plan.get("dialogue") or [],plan.get("subtitle_lines") or [],srt,lang)
                if srt.stat().st_size: sidecars.append((lang,srt))
                else: srt.unlink(missing_ok=True)
        for lang,srt in sidecars:
            cmd += ["-i",str(srt)]
        cmd += ["-map","0:v:0","-map","0:a?"]
        if alternate_audio:
            cmd += ["-map",f"{1}:a:0"]
        subtitle_input_start=2 if alternate_audio else 1
        for idx,_ in enumerate(sidecars):
            cmd += ["-map",f"{subtitle_input_start+idx}:0"]
        cmd += ["-c:v","libx264","-preset",str(plan.get("preset","veryfast")),"-crf",str(int(plan.get("crf",18))),"-pix_fmt","yuv420p","-c:a","copy"]
        if alternate_audio:
            cmd += ["-metadata:s:a:1",f"language={('eng' if source_language.startswith('ar') else 'ara')}"]
        if sidecars:
            cmd += ["-c:s","mov_text"]
            for idx,(lang,_) in enumerate(sidecars):
                cmd += [f"-metadata:s:s:{idx}",f"language={('ara' if lang=='ar' else 'eng')}"]
        cmd += ["-movflags","+faststart",str(output)]
        run_checked(cmd,"video finishing")
        return {"output":str(output),"audio_tracks":len(speech)+len(alternate_speech)+sum(bool(plan.get(k)) for k in ("ambience","music"))+len(plan.get("sfx") or []),"speech_segments":len(speech),"alternate_language_segments":len(alternate_speech),"dual_language_audio":bool(alternate_audio),"final_fps":final_fps,"interpolation":bool(plan.get("interpolate",True)),"subtitle_files":[str(p) for _,p in sidecars],"subtitle_tracks_embedded":len(sidecars),"translation_warnings":translation_warnings,"lip_sync":lip_sync_info,"upscaling":upscale_info,"limitations":"Translation requires internet; MuseTalk and Real-ESRGAN require their separate model bundles. FFmpeg interpolation can show artifacts."}

def main():
    p=argparse.ArgumentParser(description="ELLA bilingual audio/video finishing")
    p.add_argument("--video",type=Path,required=True); p.add_argument("--output",type=Path,required=True); p.add_argument("--plan",type=Path,required=True)
    a=p.parse_args(); print(json.dumps(postprocess(a.video,a.output,a.plan),ensure_ascii=False,indent=2))

if __name__=="__main__":
    try: main()
    except Exception as exc:
        print(f"[ELLA POST-PRODUCTION ERROR] {exc}",file=sys.stderr); raise
