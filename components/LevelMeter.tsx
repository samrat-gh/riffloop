"use client";

import { useRef, useState } from "react";
import type { LoopEngine } from "@/lib/audio/engine";
import { useFrame } from "@/lib/hooks/useFrame";

const HOLD_MS = 1000;
const CLIP = 0.99;

/** Maps a linear peak to 0..1 on a -60..0 dBFS scale. */
const toMeter = (peak: number) => Math.min(1, Math.max(0, (20 * Math.log10(peak || 1e-6) + 60) / 60));

export function LevelMeter({ engine }: { engine: LoopEngine }) {
  const [level, setLevel] = useState(0);
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
    setLevel(toMeter(peak));
    setHeld(toMeter(h.peak));
    setClipping(now - h.clipAt < HOLD_MS);
  });

  return (
    <div className="flex items-center gap-3" aria-label="Input level">
      <span className="text-xs uppercase tracking-widest text-zinc-500">In</span>
      <div className="relative h-2.5 flex-1 overflow-hidden rounded-full bg-zinc-800">
        <div
          className={`h-full rounded-full ${clipping ? "bg-red-500" : "bg-emerald-500"}`}
          style={{ width: `${level * 100}%` }}
        />
        <div className="absolute top-0 h-full w-0.5 bg-zinc-200" style={{ left: `calc(${held * 100}% - 1px)` }} />
      </div>
      <span className={`w-10 text-xs font-bold ${clipping ? "text-red-500" : "text-transparent"}`}>CLIP</span>
    </div>
  );
}
