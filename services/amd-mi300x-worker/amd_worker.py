#!/usr/bin/env python3
"""Ella2027 AMD MI300X worker using AMD's documented xDiT LTX-2.5 CLI."""
import json, os, random, subprocess, threading, time
from pathlib import Path
from typing import Any
import requests

BASE=os.getenv("ELLA_API_BASE_URL","https://ella2027.onrender.com").rstrip("/")
TOKEN=os.getenv("ELLA_AMD_WORKER_TOKEN","").strip()
PREFIX="/api/kaggle-worker"
MODEL=os.getenv("ELLA_XDIT_MODEL","Lightricks/LTX-2.5-Diffusers")
ROOT=Path(os.getenv("ELLA_OUTPUT_DIR","/app/output"))
MAX_BYTES=100*1024*1024
FPS=24
STEPS=8
MAX_SECONDS=10

def url(path): return f"{BASE}{PREFIX}{path}"
def headers(): return {"Authorization":f"Bearer {TOKEN}"}

def check():
    p=subprocess.run(["xdit","--help"],capture_output=True,text=True,timeout=60)
    if p.returncode: raise RuntimeError("AMD xDiT CLI is not installed: "+p.stderr[-1200:])
    r=requests.get(url("/health"),headers=headers(),timeout=25); r.raise_for_status()
    print("[ELLA AMD] API:",r.json(),flush=True)
    import torch
    if not torch.cuda.is_available() or not getattr(torch.version,"hip",None):
        raise RuntimeError("ROCm PyTorch GPU unavailable. Refusing to run on CPU or CUDA.")
    print(f"[ELLA AMD] ROCm {torch.version.hip}; GPUs={torch.cuda.device_count()}; GPU0={torch.cuda.get_device_name(0)}",flush=True)

def size(ratio):
    if ratio in ("9:16","portrait"): return 1024,576
    if ratio in ("1:1","square"): return 768,768
    return 576,1024

def generate(job):
    seconds=int(job.get("durationSeconds") or 5)
    if not 1<=seconds<=MAX_SECONDS: raise RuntimeError(f"Scene duration {seconds}s outside supported 1-{MAX_SECONDS}s.")
    if job.get("mode")=="image": raise RuntimeError("AMD xDiT worker currently accepts text-to-video scenes only; image-to-video was not silently substituted.")
    prompt=str(job.get("prompt") or "").strip()
    if not prompt: raise RuntimeError("Empty scene prompt.")
    h,w=size(str(job.get("aspectRatio") or "16:9"))
    frames=seconds*FPS+1
    out=ROOT/f"job_{job['id']}"
    out.mkdir(parents=True,exist_ok=True)
    cmd=["xdit","--model",MODEL,"--seed",str(random.randint(1,2**31-1)),
         "--task","t2v","--prompt",prompt,"--height",str(h),"--width",str(w),
         "--num_frames",str(frames),"--num_inference_steps",str(STEPS),
         "--ulysses_degree","1","--use_torch_compile","--guidance_scale","1.0",
         "--num_iterations","1","--attention_backend","aiter","--output_directory",str(out)]
    print(f"[ELLA AMD] xDiT start job={job['id']} {w}x{h} {seconds}s/{frames}frames steps={STEPS}",flush=True)
    p=subprocess.Popen(cmd,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,bufsize=1)
    tail=[]
    for line in p.stdout:
        print("[xDiT] "+line.rstrip(),flush=True)
        tail.append(line.rstrip())
        if len(tail)>80: tail.pop(0)
    rc=p.wait()
    if rc: raise RuntimeError(f"xDiT exited {rc}: {' | '.join(tail[-20:])}")
    candidates=sorted(out.rglob("*.mp4"),key=lambda x:x.stat().st_mtime,reverse=True)
    video=next((x for x in candidates if x.is_file() and x.stat().st_size),None)
    if video is None: raise RuntimeError("xDiT completed but no MP4 was found.")
    probe=subprocess.run(["ffprobe","-v","error","-show_entries","stream=codec_type","-of","json",str(video)],capture_output=True,text=True,timeout=45)
    if probe.returncode: raise RuntimeError("ffprobe failed: "+probe.stderr[-800:])
    types={s.get("codec_type") for s in json.loads(probe.stdout).get("streams",[])}
    if not {"video","audio"}.issubset(types): raise RuntimeError(f"Refusing silent/incomplete result; streams={sorted(types)}")
    if video.stat().st_size>MAX_BYTES: raise RuntimeError(f"MP4 exceeds Ella upload limit ({video.stat().st_size/1048576:.1f} MiB).")
    return video

def heartbeat(job,stop,state):
    while not stop.wait(40):
        try:
            r=requests.post(url(f"/{job['id']}/heartbeat"),headers=headers(),json={"leaseToken":job["leaseToken"]},timeout=25)
            if r.status_code==409: state["lost"]=True; return
            r.raise_for_status()
        except Exception as e: print("[ELLA AMD] heartbeat retry:",e,flush=True)

def upload_and_complete(job,video):
    u=job["upload"]
    with video.open("rb") as f:
        r=requests.post(u["uploadUrl"],data={"api_key":u["apiKey"],"timestamp":u["timestamp"],"folder":u["folder"],"public_id":u["publicId"],"signature":u["signature"]},files={"file":(video.name,f,"video/mp4")},timeout=(30,600))
    r.raise_for_status()
    secure=r.json().get("secure_url")
    if not secure: raise RuntimeError("Cloudinary response has no secure_url.")
    r=requests.post(url(f"/{job['id']}/complete"),headers=headers(),json={"leaseToken":job["leaseToken"],"videoUrl":secure,"bytes":video.stat().st_size},timeout=60)
    r.raise_for_status()
    print(f"[ELLA AMD] COMPLETED {job['id']} -> {secure}",flush=True)

def process_one():
    r=requests.post(url("/claim"),headers=headers(),json={},timeout=(20,40)); r.raise_for_status()
    job=r.json().get("job")
    if not job: return False
    print("[ELLA AMD] CLAIMED",job["id"],flush=True)
    stop=threading.Event(); state={"lost":False}
    t=threading.Thread(target=heartbeat,args=(job,stop,state),daemon=True); t.start()
    try:
        video=generate(job)
        if state["lost"]: raise RuntimeError("Lease lost; refusing stale upload.")
        upload_and_complete(job,video)
    except Exception as e:
        msg=str(e)[:800]; print("[ELLA AMD] FAILED",job["id"],msg,flush=True)
        try:
            requests.post(url(f"/{job['id']}/fail"),headers=headers(),json={"leaseToken":job["leaseToken"],"error":msg},timeout=30).raise_for_status()
        except Exception as e2: print("[ELLA AMD] Could not report failure:",e2,flush=True)
    finally:
        stop.set(); t.join(timeout=3)
    return True

def main():
    if not TOKEN: raise RuntimeError("ELLA_AMD_WORKER_TOKEN is required.")
    if not BASE.startswith("https://"): raise RuntimeError("ELLA_API_BASE_URL must be HTTPS.")
    check()
    print("[ELLA AMD] Worker online. Polling Ella queue.",flush=True)
    while True:
        try:
            if not process_one(): time.sleep(10)
        except KeyboardInterrupt: break
        except Exception as e: print("[ELLA AMD] poll error:",e,flush=True); time.sleep(10)

if __name__=="__main__": main()
