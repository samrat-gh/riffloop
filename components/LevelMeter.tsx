"use client";

import { useRef, useState } from "react";
import type { LoopEngine } from "@/lib/audio/engine";
import { useFrame } from "@/lib/hooks/useFrame";

const HOLD_MS = 1000;
const CLIP = 0.99;
const SEGMENTS = 16;
const FLOOR_DB = -48;

/** Linear peak → number of lit segments on a FLOOR_DB..0 dBFS scale. */
const toSegments = (peak: number) => {
  const db = 20 * Math.log10(peak || 1e-6);
  return Math.round(Math.min(1, Math.max(0, (db - FLOOR_DB) / -FLOOR_DB)) * SEGMENTS);
};

const segColor = (i: number) =>
  i >= SEGMENTS - 1 ? "var(--color-rec)" : i >= SEGMENTS - 4 ? "var(--color-dub)" : "var(--color-play)";

/** LED ladder meter with peak hold, like the input meter on a pedal or interface. */
export function LevelMeter({ engine }: { engine: LoopEngine }) {
  const [lit, setLit] = useState(0);
  const [held, setHeld] = useState(0);
  const [clipping, setClipping] = useState(false);
  const hold = useRef({ peak: 0, at: 0, clipAt: -Infinity });

  useFrame(() => {
    const peak = engine.inputPeak();
    const now = performance.now();
    const h = hold.current;
    if (peak >= h.peak || now - h.at > HOLD_MS) {
      h.peak = peak;
      h.at = now;
    }
    if (peak >= CLIP) h.clipAt = now;
    setLit(toSegments(peak));
    setHeld(toSegments(h.peak));
    setClipping(now - h.clipAt < HOLD_MS);
  });

  return (
    <div className="flex items-center gap-3">
      <span className="font-label text-sm font-medium text-dim">Input</span>
      <div className="flex flex-1 gap-[3px]" role="meter" aria-label="Input level" aria-valuemin={0} aria-valuemax={SEGMENTS} aria-valuenow={lit}>
        {Array.from({ length: SEGMENTS }, (_, i) => {
          const on = i < lit || i === held - 1;
          return (
            <span
              key={i}
              className="h-2 flex-1 rounded-[2px] transition-[background-color] duration-75"
              style={{
                background: on ? segColor(i) : "var(--color-led-off)",
                boxShadow: on ? `0 0 6px ${segColor(i)}` : undefined,
              }}
            />
          );
        })}
      </div>
      <span
        className={`w-10 font-label text-sm font-semibold ${clipping ? "text-rec" : "text-transparent"}`}
        aria-live="polite"
      >
        {clipping ? "Clip" : ""}
      </span>
    </div>
  );
}
