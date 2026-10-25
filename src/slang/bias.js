// Hotword bias as a percentage: the ONE place that maps what the user sees (percent) to what sherpa-onnx gets (hotwords score).
// Used by the main process (settings, hotwords file, logs) and by the renderer (Dictionary page), so it has no dependencies.
//
//   percent = score / 3 x 100      score = percent / 100 x 3
//   100% = score 3 (the most the app allows; measured: at 3 the model starts inventing words)
//   50%  = score 1.5 (the default)            33% = score 1, 67% = score 2 (1 to 2 measured best)
//   1%   = score 0.03 (the least). 0% is not a level: biasing off is the separate switch.
//
// Percent is always a whole number 1..100. Old settings stored a score (0.1..3); it still loads and shows as its percentage
// (0.1 -> 3%). Bad input (NaN, text, null, Infinity) gives the default 50% when a default is wanted, or null for "use the global".
(function (root) {
  const MAX_SCORE = 3;
  const MIN_PCT = 1, MAX_PCT = 100, DEFAULT_PCT = 50;
  const MIN_SCORE = MIN_PCT / 100 * MAX_SCORE;            // 0.03
  const DEFAULT_SCORE = DEFAULT_PCT / 100 * MAX_SCORE;    // 1.5

  // a finite number from a number or a numeric string ("70", "70%", " 70 % "); anything else -> NaN
  function num(v) {
    if (typeof v === 'number') return v;
    if (typeof v !== 'string') return NaN;
    const s = v.trim().replace(/\s*%$/, '');
    return /^[+-]?(\d+\.?\d*|\.\d+)$/.test(s) ? Number(s) : NaN;
  }
  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

  /** a score -> whole percent 1..100; bad input -> the default 50 */
  function scoreToPercent(score) {
    const x = num(score);
    if (!Number.isFinite(x)) return DEFAULT_PCT;
    return clamp(Math.round(x / MAX_SCORE * 100), MIN_PCT, MAX_PCT);
  }
  /** a percent -> score 0.03..3, rounded to whole percents first so the round trip is exact; bad input -> the default 1.5 */
  function percentToScore(pct) {
    const p = normPercent(pct);
    return p === null ? DEFAULT_SCORE : Math.round(p * MAX_SCORE * 100) / 10000;    // p*3/100 without float noise (51 -> 1.53)
  }
  /** user input -> whole percent 1..100, or null when it is not a number at all */
  function normPercent(pct) {
    const x = num(pct);
    return Number.isFinite(x) ? clamp(Math.round(x), MIN_PCT, MAX_PCT) : null;
  }
  /** a stored score (any age) -> the score the app uses: clamped to 0.03..3, bad -> 1.5 */
  function normScore(score) {
    const x = num(score);
    return Number.isFinite(x) ? clamp(x, MIN_SCORE, MAX_SCORE) : DEFAULT_SCORE;
  }
  /** strict check for a typed value: '' -> null (meaning "use the global"), else {pct} or {error} */
  function parsePercentInput(v) {
    const s = String(v ?? '').trim();
    if (!s) return { pct: null };
    const x = num(s);
    if (!Number.isFinite(x)) return { error: 'Bias must be a number from 1 to 100.' };
    if (x < MIN_PCT || x > MAX_PCT) return { error: 'Bias must be from 1% to 100%.' };
    return { pct: Math.round(x) };
  }
  const label = (pct) => `${pct}%`;

  const api = { MAX_SCORE, MIN_SCORE, DEFAULT_SCORE, MIN_PCT, MAX_PCT, DEFAULT_PCT, scoreToPercent, percentToScore, normPercent, normScore, parsePercentInput, label };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.PFBias = api;
})(typeof window !== 'undefined' ? window : globalThis);
