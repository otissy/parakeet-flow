'use strict';

function candidates(value) {
  if (Array.isArray(value)) return value.flatMap(candidates);
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value.words) && value.words.length) return value.words;
  if (Array.isArray(value.segments) && value.segments.length) return value.segments.flatMap((s) => {
    if (Array.isArray(s.words) && s.words.length) return s.words;
    return [s];
  });
  if (value.text !== undefined || value.word !== undefined || value.token !== undefined) return [value];
  for (const key of ['results', 'transcripts', 'result', 'transcript']) {
    if (value[key] !== undefined) {
      const found = candidates(value[key]);
      if (found.length) return found;
    }
  }
  return [];
}

function wordText(word) {
  return String(word?.text ?? word?.word ?? word?.token ?? '').trim();
}

function speakerName(value) {
  if (Number.isFinite(Number(value)) && Number(value) > 0) return `Speaker ${Math.floor(Number(value))}`;
  const label = String(value ?? '').trim();
  const match = label.match(/^speaker[_\s-]?(\d+)$/i);
  if (match) return `Speaker ${match[1]}`;
  return label || 'Unknown speaker';
}

function formatWord(word) {
  const start = Number(word?.start ?? word?.start_time ?? word?.begin);
  const end = Number(word?.end ?? word?.end_time ?? word?.stop);
  const text = wordText(word);
  if (!text || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start) return null;
  return {
    start, end, text,
    speaker: speakerName(word?.speaker ?? word?.speaker_id ?? word?.speaker_tag),
  };
}

function punctuationOnly(text) { return /^[,.;:!?%)\]}]/u.test(text); }

function normalizeTranscript(parsed) {
  if (typeof parsed === 'string') {
    try { parsed = JSON.parse(parsed); } catch (e) { throw new Error('NeMo returned invalid transcript JSON'); }
  }
  const words = candidates(parsed).map(formatWord).filter(Boolean).sort((a, b) => a.start - b.start);
  if (!words.length) {
    const root = Array.isArray(parsed) ? parsed[0] : parsed;
    const text = String(root?.text ?? root?.transcript ?? '').trim();
    if (!text) throw new Error('NeMo returned no transcript words');
    const duration = Number(root?.audio_seconds ?? root?.duration);
    return [{ id: undefined, start: 0, end: Number.isFinite(duration) && duration >= 0 ? duration : 0, speaker: 'Unknown speaker', text }];
  }

  const segments = [];
  for (const word of words) {
    const current = segments[segments.length - 1];
    if (current && current.speaker === word.speaker && word.start - current.end <= 0.85) {
      current.text += punctuationOnly(word.text) ? word.text : ` ${word.text}`;
      current.end = Math.max(current.end, word.end);
    } else {
      segments.push({ start: word.start, end: word.end, speaker: word.speaker, text: word.text });
    }
  }
  return segments;
}

module.exports = { normalizeTranscript, speakerName };
