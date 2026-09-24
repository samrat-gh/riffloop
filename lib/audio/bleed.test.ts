import { describe, expect, it } from "vitest";
import { removeBleed } from "./bleed";
import { fft } from "./fft";

const SR = 48000;
const rms = (x: ArrayLike<number>) => {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i] * x[i];
  return Math.sqrt(s / x.length);
};

let seed = 11;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;

/** A 4 s "loop": noisy chords, as it would play from the speakers. */
const loop = Float32Array.from({ length: SR * 4 }, (_, i) => {
  const t = i / SR;
  return 0.3 * Math.sin(2 * Math.PI * 220 * t) * Math.exp(-(t % 0.5) * 4) + 0.05 * rand();
});

/** A new guitar part: plucks at a different pitch, uncorrelated with the loop. */
const guitar = Float32Array.from({ length: SR * 4 }, (_, i) => {
  const t = i / SR;
  return 0.25 * Math.sin(2 * Math.PI * 330 * t) * Math.exp(-((t + 0.25) % 0.7) * 5);
});

/** The loop as the mic hears it: 3 ms late (circular), quieter, and darkened by a simple low-pass. */
function throughSpeakers(x: Float32Array): Float32Array {
  const d = Math.round(SR * 0.003);
  const y = new Float32Array(x.length);
  let lp = 0;
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < x.length; i++) {
      lp += 0.3 * (x[(i - d + x.length) % x.length] - lp);
      if (pass === 1) y[i] = 0.5 * lp;
    }
  }
  return y;
}

describe("fft", () => {
  it("round-trips", () => {
    const re = Float64Array.from({ length: 64 }, (_, i) => Math.sin(i) + i / 10);
    const im = new Float64Array(64);
    const orig = re.slice();
    fft(re, im);
    fft(re, im, true);
    re.forEach((v, i) => expect(v).toBeCloseTo(orig[i], 9));
  });
});

describe("removeBleed", () => {
  it("removes most of the loop from the take and keeps the guitar", () => {
    const bleed = throughSpeakers(loop);
    const take = guitar.map((g, i) => g + bleed[i]);
    const out = removeBleed(take, loop);
    const residual = out.map((v, i) => v - guitar[i]);
    expect(rms(residual) / rms(bleed)).toBeLessThan(0.1); // at least 20 dB of bleed removed
    const kept = out.reduce((s, v, i) => s + v * guitar[i], 0) / guitar.reduce((s, v) => s + v * v, 0);
    expect(kept).toBeGreaterThan(0.95); // guitar level preserved
  });

  it("leaves the take alone when nothing was playing", () => {
    const out = removeBleed(guitar, new Float32Array(guitar.length));
    const diff = out.map((v, i) => v - guitar[i]);
    expect(rms(diff)).toBeLessThan(rms(guitar) * 1e-3);
  });

  it("keeps unrecorded parts of a short take silent", () => {
    const bleed = throughSpeakers(loop);
    const half = SR * 2;
    const take = guitar.map((g, i) => (i < half ? g + bleed[i] : 0));
    const out = removeBleed(take, loop, (i) => i < half);
    expect(rms(out.subarray(half))).toBe(0);
  });
});
