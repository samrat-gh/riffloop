import { describe, expect, it } from "vitest";
import { fadeAt, fadeEdges, writeWrapped } from "./buffer";

describe("writeWrapped", () => {
  it("wraps past the loop end", () => {
    const layer = new Float32Array(4);
    writeWrapped(layer, Float32Array.from([1, 2, 3]), 2);
    expect([...layer]).toEqual([3, 0, 1, 2]);
  });

  it("sums across multiple passes", () => {
    const layer = new Float32Array(3);
    writeWrapped(layer, Float32Array.from([1, 1, 1, 1, 1, 1, 1]), 0);
    expect([...layer]).toEqual([3, 2, 2]);
  });

  it("handles positions beyond and below the loop", () => {
    const layer = new Float32Array(4);
    writeWrapped(layer, Float32Array.from([1]), 9);
    writeWrapped(layer, Float32Array.from([5]), -1);
    expect([...layer]).toEqual([0, 1, 0, 5]);
  });
});

describe("fades", () => {
  it("fadeEdges ramps both ends and keeps the middle", () => {
    const buf = new Float32Array(10).fill(1);
    fadeEdges(buf, 2);
    expect([...buf]).toEqual([0, 0.5, 1, 1, 1, 1, 1, 1, 0.5, 0]);
  });

  it("fadeAt wraps around the loop boundary", () => {
    const inLayer = new Float32Array(4).fill(1);
    fadeAt(inLayer, 3, 2, "in");
    expect([...inLayer]).toEqual([0.5, 1, 1, 0]);

    const outLayer = new Float32Array(4).fill(1);
    fadeAt(outLayer, 1, 2, "out");
    expect([...outLayer]).toEqual([0, 1, 1, 0.5]);
  });
});
