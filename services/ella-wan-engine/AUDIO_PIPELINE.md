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
