"""Synthesise the slang acceptance utterances with the Kokoro model files of claude-voice (read-only use).
usage: python gen-slang.py <claude-voice dir> <out dir> [voice]   -> slang-1.wav ... (16 kHz mono), sentences from slang-sentences.json"""
import json, os, subprocess, sys, wave
import numpy as np
from kokoro_onnx import Kokoro

cv, out = sys.argv[1], sys.argv[2]
voice = sys.argv[3] if len(sys.argv) > 3 else "af_heart"
os.makedirs(out, exist_ok=True)
here = os.path.dirname(os.path.abspath(__file__))
sentences = json.load(open(os.path.join(here, "slang-sentences.json"), encoding="utf-8"))
k = Kokoro(os.path.join(cv, "models", "kokoro-v1.0.int8.onnx"), os.path.join(cv, "models", "voices-v1.0.bin"))
for name, text in sentences.items():
    a, sr = k.create(text, voice=voice, speed=1.0, lang="en-us")
    a = np.concatenate([np.zeros(int(sr * 0.4), np.float32), np.asarray(a, np.float32), np.zeros(int(sr * 0.4), np.float32)])
    tmp = os.path.join(out, name + ".24k.wav")
    with wave.open(tmp, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr)
        w.writeframes((np.clip(a, -1, 1) * 32767).astype('<i2').tobytes())
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", tmp, "-ar", "16000", "-ac", "1", os.path.join(out, name + ".wav")], check=True)
    os.remove(tmp)
    print(name, round(len(a) / sr, 1), "s")
