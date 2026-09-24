/** Adds `samples` into the circular `layer` starting at `pos`, wrapping at the end. */
export function writeWrapped(layer: Float32Array, samples: Float32Array, pos: number): void {
  const len = layer.length;
  let p = ((pos % len) + len) % len;
  for (let i = 0; i < samples.length; i++) {
    layer[p] += samples[i];
    if (++p === len) p = 0;
  }
}

/** Linear fade in over the first `n` samples and fade out over the last `n`. */
export function fadeEdges(buf: Float32Array, n: number): void {
  const m = Math.min(n, Math.floor(buf.length / 2));
  for (let i = 0; i < m; i++) {
    const g = i / m;
    buf[i] *= g;
    buf[buf.length - 1 - i] *= g;
  }
}

/**
 * Fades `n` samples of the circular `layer` starting at `pos`.
 * "in" ramps 0→1 from `pos`; "out" ramps 1→0 ending just before `pos`.
 */
export function fadeAt(layer: Float32Array, pos: number, n: number, dir: "in" | "out"): void {
  const len = layer.length;
  const m = Math.min(n, len);
  for (let i = 0; i < m; i++) {
    const g = i / m;
    const p = dir === "in" ? pos + i : pos - 1 - i;
    layer[((p % len) + len) % len] *= g;
  }
}
