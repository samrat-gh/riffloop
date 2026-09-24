import { describe, expect, it } from "vitest";
import { encodeWav } from "./wav";

const str = (v: DataView, at: number, n: number) =>
  String.fromCharCode(...Array.from({ length: n }, (_, i) => v.getUint8(at + i)));

/** Reads a signed 24-bit little-endian sample. */
const s24 = (v: DataView, at: number) => {
  const n = v.getUint8(at) | (v.getUint8(at + 1) << 8) | (v.getUint8(at + 2) << 16);
  return n & 0x800000 ? n - 0x1000000 : n;
};

describe("encodeWav", () => {
  it("writes a valid 24-bit stereo header", () => {
    const v = new DataView(encodeWav([new Float32Array(10), new Float32Array(10)], 48000));
    expect(str(v, 0, 4)).toBe("RIFF");
    expect(str(v, 8, 4)).toBe("WAVE");
    expect(v.getUint16(22, true)).toBe(2); // channels
    expect(v.getUint32(24, true)).toBe(48000);
    expect(v.getUint16(34, true)).toBe(24); // bits
    expect(v.getUint32(40, true)).toBe(10 * 2 * 3); // data bytes
    expect(v.byteLength).toBe(44 + 60);
  });

  it("interleaves channels and clamps samples", () => {
    const left = Float32Array.from([1, -1, 0.5]);
    const right = Float32Array.from([0, 2, -0.5]);
    const v = new DataView(encodeWav([left, right], 44100));
    const sample = (frame: number, ch: number) => s24(v, 44 + (frame * 2 + ch) * 3);
    expect(sample(0, 0)).toBe(0x7fffff);
    expect(sample(0, 1)).toBe(0);
    expect(sample(1, 0)).toBe(-0x800000);
    expect(sample(1, 1)).toBe(0x7fffff); // 2 clamped to 1
    expect(sample(2, 0)).toBe(Math.round(0.5 * 0x7fffff));
    expect(sample(2, 1)).toBe(Math.round(-0.5 * 0x800000));
  });
});
