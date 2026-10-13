"""Synthesise the acceptance utterances with the Kokoro daemon's model files (read-only use).
usage: python gen-audio.py <claude-voice dir> <out dir>   -> en1.wav, nl1.wav, en-pause.wav (16 kHz mono)"""
import os, subprocess, sys
import wave
import numpy as np
from kokoro_onnx import Kokoro

cv, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
k = Kokoro(os.path.join(cv, "models", "kokoro-v1.0.int8.onnx"), os.path.join(cv, "models", "voices-v1.0.bin"))

def say(text, lang="en-us", voice="af_heart"):
    a, sr = k.create(text, voice=voice, speed=1.0, lang=lang)
    return np.asarray(a, dtype=np.float32), sr

def save(name, parts):
    sr = 24000
    audio = np.concatenate([np.zeros(int(sr * 0.4), np.float32)] + parts + [np.zeros(int(sr * 0.4), np.float32)])
    tmp = os.path.join(out, name + ".24k.wav")
    with wave.open(tmp, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr)
        w.writeframes((np.clip(audio, -1, 1) * 32767).astype('<i2').tobytes())
    dst = os.path.join(out, name + ".wav")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", tmp, "-ar", "16000", "-ac", "1", dst], check=True)
    os.remove(tmp)
    print(name, round(len(audio) / sr, 1), "s")

save("en1", [say("Hello team, this is a quick test of the new dictation tool. I am speaking at a normal pace, and the words should show up while I am still talking, then settle into clean text when I let go of the key.")[0]])
save("nl1", [say("Goedemorgen allemaal, dit is een korte test van het dicteerprogramma. De woorden moeten verschijnen terwijl ik nog aan het praten ben, en daarna netjes worden afgerond.", lang="nl", voice="af_heart")[0]])
sil = np.zeros(int(24000 * 1.3), np.float32)
save("en-pause", [say("I would like to schedule the meeting for next Tuesday afternoon,")[0], sil, say("and please remind everyone to bring the printed reports with them.")[0]])

save("short", [say("Quick test. One, two, three. The quick brown fox jumps over the lazy dog.")[0]])
