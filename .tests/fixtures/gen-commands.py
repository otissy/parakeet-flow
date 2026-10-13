"""Synthesise the voice-command utterances (Kokoro model files read-only, same as gen-audio.py).
usage: python gen-commands.py <claude-voice dir> <out dir>   -> cmd-en.wav, cmd-nl.wav (16 kHz mono, 1.3 s pauses between segments)
cmd-en says: "Send the report to Anna before noon." / "Thanks for your help." / "Delete that." / "Note to self, buy oat milk on the way home." / "New line." / "Kind regards, Otis."
cmd-nl says: "Stuur het rapport morgen naar Anna." / "Bedankt voor de hulp." / "Verwijder dat." / "Notitie aan mezelf, bel de tandarts." / "Nieuwe regel." / "Met vriendelijke groet, Otis." """
import os, subprocess, sys
import wave
import numpy as np
from kokoro_onnx import Kokoro

cv, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
k = Kokoro(os.path.join(cv, "models", "kokoro-v1.0.int8.onnx"), os.path.join(cv, "models", "voices-v1.0.bin"))

def say(text, lang="en-us", voice="af_heart"):
    a, sr = k.create(text, voice=voice, speed=1.0, lang=lang)
    return np.asarray(a, dtype=np.float32)

def save(name, parts):
    sr = 24000
    sil = np.zeros(int(sr * 1.3), np.float32)
    seq = [np.zeros(int(sr * 0.4), np.float32)]
    for i, p in enumerate(parts):
        seq.append(p)
        seq.append(sil if i < len(parts) - 1 else np.zeros(int(sr * 0.4), np.float32))
    audio = np.concatenate(seq)
    tmp = os.path.join(out, name + ".24k.wav")
    with wave.open(tmp, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr)
        w.writeframes((np.clip(audio, -1, 1) * 32767).astype('<i2').tobytes())
    dst = os.path.join(out, name + ".wav")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", tmp, "-ar", "16000", "-ac", "1", dst], check=True)
    os.remove(tmp)
    print(name, round(len(audio) / sr, 1), "s")

save("cmd-en", [say(t) for t in ["Send the report to Anna before noon.", "Thanks for your help.", "Delete that.", "Note to self, buy oat milk on the way home.", "New line.", "Kind regards, Otis."]])
save("cmd-nl", [say(t, lang="nl") for t in ["Stuur het rapport morgen naar Anna.", "Bedankt voor de hulp.", "Verwijder dat.", "Notitie aan mezelf, bel de tandarts.", "Nieuwe regel.", "Met vriendelijke groet, Otis."]])
