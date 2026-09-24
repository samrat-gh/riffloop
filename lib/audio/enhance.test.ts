import { describe, expect, it } from "vitest";
import { compress, enhance, gateThreshold, highpass, noiseGate, normalize } from "./enhance";

const SR = 48000;

const rms = (x: Float32Array, from = 0, to = x.length) => {
  let s = 0;
  for (let i = from; i < to; i++) s += x[i] * x[i];
  return Math.sqrt(s / (to - from));
};

/** 1 s loop: 0.5 s of a 440 Hz "note" at -12 dBFS, then 0.5 s of hiss at -60 dBFS. */
function take(): Float32Array {
  const x = new Float32Array(SR);
  let seed = 1;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (let i = 0; i < SR; i++) {
    const hiss = rand() * 0.001;
    x[i] = hiss + (i < SR / 2 ? 0.25 * Math.sin((2 * Math.PI * 440 * i) / SR) : 0);
  }
  return x;
}

describe("enhance", () => {
  it("keeps the length, so layers stay loop-aligned", () => {
    expect(enhance(take(), SR).length).toBe(SR);
  });

  it("high-pass removes low rumble but keeps guitar range", () => {
    const tone = (hz: number) => Float32Array.from({ length: SR }, (_, i) => Math.sin((2 * Math.PI * hz * i) / SR));
    expect(rms(highpass(tone(20), SR))).toBeLessThan(0.1);
    expect(rms(highpass(tone(440), SR))).toBeGreaterThan(0.65);
  });

  it("gate turns down the hiss and leaves the note", () => {
    // 0.5 s note, then a 1.5 s gap of hiss.
    const x = new Float32Array(SR * 2);
    x.set(take().subarray(0, SR / 2));
    x.set(take().subarray(SR / 2), SR / 2);
    x.set(take().subarray(SR / 2), SR);
    x.set(take().subarray(SR / 2), SR * 1.5);
    const y = noiseGate(x, SR);
    // The gate fades down over ~150 ms after the note, so measure once the fade is done.
    const hissBefore = rms(x, SR * 1.2, SR * 1.9);
    const hissAfter = rms(y, SR * 1.2, SR * 1.9);
    expect(hissAfter).toBeLessThan(hissBefore * 0.35); // ≥ ~9 dB quieter
    expect(rms(y, SR * 0.1, SR * 0.4)).toBeCloseTo(rms(x, SR * 0.1, SR * 0.4), 2);
  });

  it("never drops suddenly in level: no pumping or choppy fades", () => {
    // Strums that ring out into hiss, with a quiet pick in the tail: the case that used to chop and pump.
    let seed = 3;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
    const x = Float32Array.from({ length: SR * 4 }, (_, i) => {
      const t = i / SR;
      const tn = t % 2;
      const pick = tn > 1.2 ? 0.035 * Math.exp(-(tn - 1.2) * 4) * Math.sin(2 * Math.PI * 330 * t) : 0;
      return 0.5 * Math.exp(-tn * 6) * Math.sin(2 * Math.PI * 147 * t) + pick + rand() * 0.0018;
    });
    const ref = highpass(x, SR);
    const y = enhance(x, SR);
    const win = SR * 0.02;
    let prev = NaN;
    let maxJump = 0;
    for (let w = 0; w < x.length / win; w++) {
      const g = 20 * Math.log10(rms(y, w * win, (w + 1) * win) / rms(ref, w * win, (w + 1) * win));
      // Only drops count: a gate opening on a note's attack is masked by the note itself.
      if (!Number.isNaN(prev)) maxJump = Math.max(maxJump, prev - g);
      prev = g;
    }
    expect(maxJump).toBeLessThan(1.5); // dB per 20 ms
  });

  it("gate threshold ignores digital silence, so a partly recorded layer gates like the finished one", () => {
    const full = take();
    const partial = take();
    partial.fill(0, SR * 0.8);
    expect(gateThreshold(partial, SR)).toBeCloseTo(gateThreshold(full, SR), 4);
  });

  it("gate threshold is capped for takes with no quiet parts", () => {
    const loud = Float32Array.from({ length: SR }, (_, i) => 0.5 * Math.sin((2 * Math.PI * 440 * i) / SR));
    expect(gateThreshold(loud, SR)).toBeLessThanOrEqual(10 ** (-40 / 20));
  });

  it("normalize evens out levels and never clips", () => {
    const quiet = take().map((v) => v * 0.1);
    const loud = take().map((v) => v * 3);
    const a = normalize(quiet, SR);
    const b = normalize(loud, SR);
    expect(rms(a, 0, SR / 2)).toBeCloseTo(rms(b, 0, SR / 2), 2);
    expect(Math.max(...b.map(Math.abs))).toBeLessThanOrEqual(10 ** (-1 / 20) + 1e-6);
  });

  it("compressor reduces loud peaks more than quiet ones", () => {
    const tone = (amp: number) => Float32Array.from({ length: SR }, (_, i) => amp * Math.sin((2 * Math.PI * 440 * i) / SR));
    const loudRatio = rms(compress(tone(0.8), SR)) / rms(tone(0.8));
    const quietRatio = rms(compress(tone(0.02), SR)) / rms(tone(0.02));
    expect(loudRatio).toBeLessThan(0.5);
    expect(quietRatio).toBeCloseTo(1, 2);
  });
});
