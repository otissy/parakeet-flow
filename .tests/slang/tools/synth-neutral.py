"""Synthesise the neutral (slang-free) sentences with the Kokoro model files of claude-voice (read-only use).
usage: python synth-neutral.py <claude-voice dir> <sentences.json> <out dir> <voice>   -> <out>/<voice>/NNNN.wav + manifest.json"""
import json, os, subprocess, sys, wave
import numpy as np
from kokoro_onnx import Kokoro

cv, src, out, voice = sys.argv[1:5]
sentences = json.load(open(src, encoding='utf-8'))
d = os.path.join(out, voice); os.makedirs(d, exist_ok=True)
k = Kokoro(os.path.join(cv, "models", "kokoro-v1.0.int8.onnx"), os.path.join(cv, "models", "voices-v1.0.bin"))
manifest = []
for i, t in enumerate(sentences):
    name = "%04d" % i; dst = os.path.join(d, name + ".wav")
    if not os.path.exists(dst):
        a, sr = k.create(t, voice=voice, speed=1.0, lang="en-us")
        a = np.concatenate([np.zeros(int(sr * 0.4), np.float32), np.asarray(a, np.float32), np.zeros(int(sr * 0.4), np.float32)])
        tmp = os.path.join(d, name + ".24k.wav")
        with wave.open(tmp, 'wb') as w:
            w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr)
            w.writeframes((np.clip(a, -1, 1) * 32767).astype('<i2').tobytes())
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", tmp, "-ar", "16000", "-ac", "1", dst], check=True)
        os.remove(tmp)
    manifest.append({"i": i, "term": t, "wav": name + ".wav"})
json.dump(manifest, open(os.path.join(d, "manifest.json"), "w", encoding="utf-8"), indent=1)
print(voice, len(manifest), "neutral wavs")
