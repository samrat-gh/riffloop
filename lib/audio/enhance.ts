/**
 * "Enhance": cleanup applied to a finished layer, offline, in plain JS.
 * No lookahead or buffering, so nothing shifts in time and loops stay aligned.
 * Every stage treats the layer as circular (it loops), so filters and envelopes
 * are run over two copies and the second, settled copy is kept.
 */

const dbToGain = (db: number) => 10 ** (db / 20);

const HIGHPASS_HZ = 80;
const GATE_RANGE = dbToGain(-12); // gated parts are turned down, not muted, so it stays natural
const GATE_MAX_THRESHOLD = dbToGain(-40); // never gate anything louder than this, even on a busy take
const TARGET_RMS = dbToGain(-20);
const PEAK_CEILING = dbToGain(-1);
const MAX_BOOST = dbToGain(18);
const COMP_THRESHOLD = dbToGain(-18); // RMS level; with layers at -20 dBFS RMS only loud strums pass it
const COMP_RATIO = 2;

/** Runs `fn` over the loop twice and keeps the second pass, so state wraps across the loop point. */
function circular(data: Float32Array, fn: (x: Float32Array) => Float32Array): Float32Array<ArrayBuffer> {
  const twice = new Float32Array(data.length * 2);
  twice.set(data);
  twice.set(data, data.length);
  return fn(twice).slice(data.length);
}

/** One-pole smoothing coefficient for a time constant in seconds. */
const coef = (sec: number, sr: number) => Math.exp(-1 / (sec * sr));

/** 2nd-order high-pass (RBJ cookbook), removes rumble, handling noise and hum below HIGHPASS_HZ. */
export function highpass(data: Float32Array, sr: number, hz = HIGHPASS_HZ): Float32Array<ArrayBuffer> {
  const w0 = (2 * Math.PI * hz) / sr;
  const cos = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * Math.SQRT1_2);
  const a0 = 1 + alpha;
  const b0 = (1 + cos) / 2 / a0;
  const b1 = -(1 + cos) / a0;
  const a1 = (-2 * cos) / a0;
  const a2 = (1 - alpha) / a0;
  return circular(data, (x) => {
    const y = new Float32Array(x.length);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < x.length; i++) {
      const v = b0 * x[i] + b1 * x1 + b0 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = x[i]; y2 = y1; y1 = v;
      y[i] = v;
    }
    return y;
  });
}

/** RMS of each 10 ms window. */
function windowRms(data: Float32Array, win: number): Float32Array {
  const out = new Float32Array(Math.ceil(data.length / win));
  for (let w = 0; w < out.length; w++) {
    let sum = 0;
    const end = Math.min(data.length, (w + 1) * win);
    for (let i = w * win; i < end; i++) sum += data[i] * data[i];
    out[w] = Math.sqrt(sum / (end - w * win));
  }
  return out;
}

/** Gate threshold: 10 dB above the quietest tenth of the take (the noise floor), capped. */
export function gateThreshold(data: Float32Array, sr: number): number {
  // Digital silence (unrecorded parts, fades) is not the room's noise floor, so skip it.
  const rms = windowRms(data, Math.round(sr * 0.01))
    .filter((r) => r > 1e-6)
    .sort();
  const floor = rms[Math.floor(rms.length * 0.1)] ?? 0;
  return Math.min(floor * dbToGain(10), GATE_MAX_THRESHOLD);
}

/**
 * Gentle noise gate. Opens when the smoothed level passes `open`, closes only after it falls 6 dB lower
 * (hysteresis) and a hold has passed, so it never chatters on fading notes. Closing is a ~150 ms fade
 * down to GATE_RANGE (a natural decay, not a cut); opening is fast so pick attacks are kept.
 */
export function noiseGate(data: Float32Array, sr: number): Float32Array<ArrayBuffer> {
  const open = gateThreshold(data, sr);
  const close = open * dbToGain(-6);
  const holdSamples = Math.round(sr * 0.1);
  const envCoef = coef(0.01, sr); // level detector, ~10 ms
  const attack = coef(0.005, sr);
  const release = coef(0.15, sr);
  return circular(data, (x) => {
    const y = new Float32Array(x.length);
    let env = 0;
    let g = 1;
    let isOpen = true;
    let held = 0;
    for (let i = 0; i < x.length; i++) {
      const p = x[i] * x[i];
      env = p + (env - p) * envCoef;
      const level = Math.sqrt(env);
      if (level >= open) {
        isOpen = true;
        held = holdSamples;
      } else if (held > 0) {
        held--;
      } else if (level < close) {
        isOpen = false;
      }
      const target = isOpen ? 1 : GATE_RANGE;
      g = target + (g - target) * (target > g ? attack : release);
      y[i] = x[i] * g;
    }
    return y;
  });
}

/** Gentle RMS compressor, no lookahead: only tames the loudest strums, without pumping. */
export function compress(data: Float32Array, sr: number): Float32Array<ArrayBuffer> {
  const envCoef = coef(0.05, sr); // average level over ~50 ms, not peaks
  const attack = coef(0.03, sr);
  const release = coef(0.4, sr);
  return circular(data, (x) => {
    const y = new Float32Array(x.length);
    let env = 0;
    let g = 1;
    for (let i = 0; i < x.length; i++) {
      const p = x[i] * x[i];
      env = p + (env - p) * envCoef;
      const level = Math.sqrt(env);
      const target = level > COMP_THRESHOLD ? (COMP_THRESHOLD / level) ** (1 - 1 / COMP_RATIO) : 1;
      g = target + (g - target) * (target < g ? attack : release);
      y[i] = x[i] * g;
    }
    return y;
  });
}

/** Brings the playing parts to TARGET_RMS, without clipping and without boosting near-silence into noise. */
export function normalize(data: Float32Array, sr: number): Float32Array<ArrayBuffer> {
  const threshold = gateThreshold(data, sr);
  const rms = windowRms(data, Math.round(sr * 0.01));
  let sum = 0;
  let n = 0;
  for (const r of rms) {
    if (r >= threshold) {
      sum += r * r;
      n++;
    }
  }
  let peak = 0;
  for (const v of data) peak = Math.max(peak, Math.abs(v));
  const out = new Float32Array(data);
  if (!n || !peak) return out;
  const gain = Math.min(TARGET_RMS / Math.sqrt(sum / n), PEAK_CEILING / peak, MAX_BOOST);
  for (let i = 0; i < out.length; i++) out[i] *= gain;
  return out;
}

/** The full Enhance chain for one layer. */
export function enhance(data: Float32Array, sr: number): Float32Array<ArrayBuffer> {
  return normalize(compress(normalize(noiseGate(highpass(data, sr), sr), sr), sr), sr);
}

/** A soft room: decaying stereo noise, darkened, with a short pre-delay. */
export function roomImpulse(sr: number, seconds = 1.4): [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>] {
  const len = Math.round(sr * seconds);
  const pre = Math.round(sr * 0.012);
  const damp = coef(0.00012, sr); // one-pole low-pass, takes the fizz off the tail
  const channel = () => {
    const ir = new Float32Array(len);
    let lp = 0;
    for (let i = pre; i < len; i++) {
      const t = (i - pre) / sr;
      const noise = Math.random() * 2 - 1;
      lp = noise + (lp - noise) * damp;
      ir[i] = lp * Math.exp(-t * (6.9 / seconds)); // -60 dB at the end
    }
    return ir;
  };
  return [channel(), channel()];
}
