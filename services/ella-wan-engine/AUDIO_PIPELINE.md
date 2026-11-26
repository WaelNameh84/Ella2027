# ELLA Audio and Video Finishing

Optional post-production stage after Wan 2.2 produces a source MP4.

## Features
- Arabic and English speech via Edge TTS (internet required).
- Per-line voice selection and start offsets.
- Optional ambience, music and SFX from supplied audio files.
- AAC mixing and loudness normalization.
- Arabic and English SRT sidecar files.
- Optional FFmpeg motion-compensated interpolation to 24/30 FPS and conservative color finishing.

## Install
pip install -r services/ella-wan-engine/requirements-audio.txt

FFmpeg and ffprobe must be on PATH.

## Plan example
{
  "language": "ar",
  "source_fps": 8,
  "final_fps": 24,
  "interpolate": true,
  "cinematic_color": true,
  "subtitles": true,
  "dialogue": [
    {"language":"ar","voice":"ar-SA-HamedNeural","text":"مرحباً، كيف حالك؟","english":"Hello, how are you?","start":0.4,"end":2.8},
    {"language":"en","voice":"en-US-GuyNeural","text":"We need to leave now.","arabic":"يجب أن نغادر الآن.","start":3.0,"end":5.0}
  ],
  "ambience": "/path/to/ambience.wav",
  "music": "/path/to/music.wav",
  "sfx": [{"path":"/path/to/footsteps.wav","start":0.8}]
}

Run:
python services/ella-wan-engine/audio_postprocess.py --video input.mp4 --output final.mp4 --plan audio_plan.json

No speech or sound is fabricated when no dialogue/assets are supplied. FFmpeg minterpolate is motion-compensated interpolation, not a learned RIFE model; fast motion can show artifacts and requires visual review. This stage does not claim AI upscaling or automatic lip-sync. Lip-sync needs a separate validated model.

## Automatic Arabic/English dialogue
When `auto_translate` is enabled (default), the pipeline attempts to translate each dialogue line to the other language using the local Argos Translate models. The model package is downloaded once when first needed; dialogue text stays on the Kaggle worker and is not sent to a translation API. The final MP4 can contain two selectable dialogue audio tracks (original language and translated language) when translation succeeds, plus selectable subtitle tracks. No translated line is fabricated when translation fails; the pipeline reports a warning.

## AI lip-sync and upscaling
The pipeline now includes adapters for:
- MuseTalk 1.5 lip-sync, using a scene dialogue timeline and a locally installed MuseTalk checkout/model bundle.
- Real-ESRGAN x4plus frame restoration/upscaling, using a locally installed Real-ESRGAN checkout and checkpoint. ELLA defaults to 2x output scaling to limit GPU load.

Set environment variables on the Kaggle worker:
- `ELLA_MUSETALK_HOME=/kaggle/working/MuseTalk`
- `ELLA_REALESRGAN_HOME=/kaggle/working/Real-ESRGAN`

The MuseTalk bundle requires the upstream model files under its `models/` directory, including MuseTalk V1.5, SD VAE, Whisper, DWPose, face parsing and ResNet weights. Real-ESRGAN requires `inference_realesrgan.py` and `weights/RealESRGAN_x4plus.pth`. The adapters fail with explicit diagnostics if a configured bundle is incomplete; if no bundle path is set, the corresponding optional stage is reported as skipped. MuseTalk's own documentation notes possible face-detail loss and jitter; one main visible speaker per scene is the safest target. See the upstream instructions before installing: https://github.com/TMElyralab/MuseTalk and https://github.com/xinntao/Real-ESRGAN.

These model bundles are intentionally not downloaded by the standard worker startup: they are large and have separate dependencies that can conflict with the Wan 2.2 CUDA environment. This avoids silently breaking the already-working Wan engine. No Wav2Lip checkpoint is used because the commonly distributed pretrained weights are restricted to non-commercial use.

## One-time Kaggle installation
The main notebook now includes a dedicated setup cell before generation/worker startup. Run it once per fresh Kaggle session. It creates an isolated Python 3.10 environment with PyTorch 2.0.1 + CUDA 11.8 for MuseTalk/MMCV, installs the Real-ESRGAN inference package into that same isolated environment, and downloads the required MuseTalk 1.5, SD-VAE, Whisper, DWPose, face-parsing, ResNet and RealESRGAN_x4plus weights. It then exports the model paths and dedicated Python executable for the ELLA postprocessor. The setup cell validates imports and files but does not generate a video. Model downloads and package installation require an active Kaggle internet session and enough disk space.
