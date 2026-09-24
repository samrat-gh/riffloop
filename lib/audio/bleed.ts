import { fft } from "./fft";

/**
 * Removes speaker bleed from an overdub take, offline.
 *
 * When recording through a microphone with speakers, the take contains the guitar plus the loop as it
 * came back from the speakers: delayed and coloured by speakers and room. RiffLoop knows exactly what
 * it played (`ref`), so it fits the speaker→mic path as a short filter h (time-domain least squares:
 * minimises the leftover loop in the take) and subtracts h * ref. This is linear and never ducks or
 * gates the guitar, unlike browser echo cancellation, which is built for voice calls.
 *
 * Both signals are one loop long and circular (positions already aligned by latency compensation).
 * `written` marks which samples of the take were actually recorded; H is estimated only from fully
 * recorded frames, and unrecorded samples stay silent.
 */
const N = 4096; // FFT block for applying the filter; must exceed TAPS
// The bleed arrives near the aligned position, give or take the latency estimate's error: search
// -5 ms … +43 ms for it. Then fit a short filter there. Fewer taps = less of the guitar leaking into
// the fit (the error grows with √(taps / loop length)).
const SEARCH_BEFORE = 256;
const SEARCH_AFTER = 2048;
const TAPS = 384; // ~8 ms: direct sound plus the first reflections
const PRE = 64; // taps kept before the arrival peak

/** Solves the symmetric Toeplitz system T x = b (T[i][j] = t[|i-j|]) by Levinson recursion. */
export function levinson(t: Float64Array, b: Float64Array): Float64Array {
  const n = b.length;
  const x = new Float64Array(n);
  let f = new Float64Array(n); // forward vector
  f[0] = 1 / t[0];
  x[0] = b[0] / t[0];
  for (let k = 1; k < n; k++) {
    let ef = 0;
    for (let i = 0; i < k; i++) ef += t[k - i] * f[i];
    const denom = 1 - ef * ef;
    const nf = new Float64Array(n);
    for (let i = 0; i <= k; i++) nf[i] = (f[i] - ef * f[k - i]) / denom; // uses symmetry: backward = reversed forward
    f = nf;
    let ex = 0;
    for (let i = 0; i < k; i++) ex += t[k - i] * x[i];
    const c = b[k] - ex;
    for (let i = 0; i <= k; i++) x[i] += c * f[k - i];
  }
  return x;
}

export function removeBleed(
  take: Float32Array,
  ref: Float32Array,
  written: (i: number) => boolean = () => true,
): Float32Array<ArrayBuffer> {
  const len = take.length;
  const out = new Float32Array(len);
  if (len < N) return Float32Array.from(take);

  const at = (i: number) => ((i % len) + len) % len;

  // 1. Exact correlations around the loop, via one large FFT (no windowing bias):
  //    xcorr(l) = Σ take[n]·ref[n-l] over recorded n, acorr(l) = Σ ref[n]·ref[n-l] over the loop.
  let size = 1;
  while (size < len + SEARCH_BEFORE + SEARCH_AFTER + TAPS) size <<= 1;
  /** ref laid out so that linear correlation in `size` equals circular correlation for our lags. */
  const refExt = new Float64Array(size);
  const maxLag = SEARCH_AFTER + TAPS;
  for (let k = 0; k < len + SEARCH_BEFORE + PRE; k++) refExt[k] = ref[at(k)];
  for (let k = size - maxLag; k < size; k++) refExt[k] = ref[at(k - size)];
  const correlate = (sig: (i: number) => number) => {
    const aRe = new Float64Array(size);
    const aIm = new Float64Array(size);
    for (let n = 0; n < len; n++) aRe[n] = sig(n);
    const bRe = refExt.slice();
    const bIm = new Float64Array(size);
    fft(aRe, aIm);
    fft(bRe, bIm);
    for (let k = 0; k < size; k++) {
      const re = aRe[k] * bRe[k] + aIm[k] * bIm[k];
      aIm[k] = aIm[k] * bRe[k] - aRe[k] * bIm[k];
      aRe[k] = re;
    }
    fft(aRe, aIm, true);
    return (lag: number) => aRe[(lag + size) % size];
  };
  let recorded = 0;
  for (let i = 0; i < len; i++) if (written(i)) recorded++;
  if (recorded < len * 0.1) return Float32Array.from(take); // too little recorded to learn from
  const xcorr = correlate((n) => (written(n) ? take[n] : 0));
  const acorr = correlate((n) => ref[n]);

  // Where does the bleed arrive? Peak of the cross-correlation within the search window.
  let peak = 0;
  let best = -1;
  for (let l = -SEARCH_BEFORE; l < SEARCH_AFTER; l++) {
    const v = Math.abs(xcorr(l));
    if (v > best) {
      best = v;
      peak = l;
    }
  }
  const first = peak - PRE; // lag of tap 0

  // Normal equations for taps at lags first .. first+TAPS-1, with a little diagonal loading.
  // Only the recorded part of the take is fitted, so scale the loop's autocorrelation to match.
  const t = Float64Array.from({ length: TAPS }, (_, l) => (acorr(l) * recorded) / len);
  if (!(t[0] > 1e-12)) return Float32Array.from(take); // nothing was playing: nothing to remove
  t[0] *= 1 + 1e-3;
  const rhs = Float64Array.from({ length: TAPS }, (_, j) => xcorr(first + j));
  const taps = levinson(t, rhs);
  const hRe = new Float64Array(N);
  const hIm = new Float64Array(N);
  hRe.set(taps);
  fft(hRe, hIm);

  // 2. Echo estimate: echo[n] = Σ taps[j]·ref[n - first - j], exactly, around the loop. Overlap-add of
  //    unwindowed blocks, zero-padded so the filter never wraps inside a block, then shifted by `first`.
  const block = N - TAPS;
  const echo = new Float64Array(len);
  for (let start = 0; start < len; start += block) {
    const re = new Float64Array(N);
    const im = new Float64Array(N);
    for (let n = 0; n < block && start + n < len; n++) re[n] = ref[start + n];
    fft(re, im);
    for (let k = 0; k < N; k++) {
      const r = re[k];
      re[k] = r * hRe[k] - im[k] * hIm[k];
      im[k] = r * hIm[k] + im[k] * hRe[k];
    }
    fft(re, im, true);
    for (let n = 0; n < N; n++) echo[at(start + n + first)] += re[n];
  }
  for (let i = 0; i < len; i++) out[i] = written(i) ? take[i] - echo[i] : 0;
  return out;
}
