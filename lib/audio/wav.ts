/** Encodes channels (equal length, -1..1) as a 24-bit PCM WAV file. */
export function encodeWav(channels: Float32Array[], sampleRate: number): ArrayBuffer {
  const numCh = channels.length;
  const frames = channels[0]?.length ?? 0;
  const bytesPerSample = 3;
  const blockAlign = numCh * bytesPerSample;
  const dataSize = frames * blockAlign;
  const buf = new ArrayBuffer(44 + dataSize);
  const v = new DataView(buf);
  const text = (at: number, s: string) => [...s].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));

  text(0, "RIFF");
  v.setUint32(4, 36 + dataSize, true);
  text(8, "WAVE");
  text(12, "fmt ");
  v.setUint32(16, 16, true); // fmt chunk size
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, numCh, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * blockAlign, true);
  v.setUint16(32, blockAlign, true);
  v.setUint16(34, 24, true);
  text(36, "data");
  v.setUint32(40, dataSize, true);

  let p = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < numCh; c++) {
      const s = Math.max(-1, Math.min(1, channels[c][i]));
      const n = Math.round(s < 0 ? s * 0x800000 : s * 0x7fffff);
      v.setUint8(p, n & 0xff);
      v.setUint8(p + 1, (n >> 8) & 0xff);
      v.setUint8(p + 2, (n >> 16) & 0xff);
      p += 3;
    }
  }
  return buf;
}
