"use client";

import { useState, type ReactNode } from "react";
import type { LoopEngine } from "@/lib/audio/engine";
import { useFrame } from "@/lib/hooks/useFrame";
import type { LooperState } from "@/lib/looperState";

const SEGMENTS = 40;
const TAIL = 5; // lit segments trailing the head while recording

export const STATE_COLOR: Record<LooperState, string> = {
  idle: "var(--color-led-off)",
  countdown: "var(--color-rec)",
  recording: "var(--color-rec)",
  playing: "var(--color-play)",
  overdubbing: "var(--color-dub)",
  paused: "var(--color-play)",
  stopped: "var(--color-play)",
  error: "var(--color-rec)",
};

/** Which segments are lit, and which one is the bright head. */
function readRing(engine: LoopEngine | null, state: LooperState, countIn: number): { lit: number[]; head: number } {
  if (!engine) return { lit: [], head: -1 };
  if (state === "countdown" || (state === "overdubbing" && engine.countdownRemaining() > 0)) {
    const n = Math.ceil((engine.countdownRemaining() / Math.max(1, countIn)) * SEGMENTS);
    return { lit: Array.from({ length: n }, (_, i) => i), head: -1 };
  }
  if (state === "recording") {
    // No loop length yet: a chasing light, one turn every 2 s.
    const head = Math.floor((engine.recordingElapsed() / 2) * SEGMENTS) % SEGMENTS;
    return { lit: Array.from({ length: TAIL }, (_, i) => (head - i + SEGMENTS) % SEGMENTS), head };
  }
  const dur = engine.loopDuration();
  if (!dur) return { lit: [], head: -1 };
  const head = Math.min(SEGMENTS - 1, Math.floor((engine.position() / dur) * SEGMENTS));
  return { lit: Array.from({ length: head + 1 }, (_, i) => i), head };
}

/** LED ring around the footswitch. Shows loop position, count-in, or recording activity. */
export function LoopProgress({
  engine,
  state,
  countIn,
  children,
}: {
  engine: LoopEngine | null;
  state: LooperState;
  countIn: number;
  children: ReactNode;
}) {
  const [ring, setRing] = useState(() => readRing(engine, state, countIn));
  useFrame(() => setRing(readRing(engine, state, countIn)));

  const color = STATE_COLOR[state];
  const dimmed = state === "paused" || state === "stopped";
  const lit = new Set(ring.lit);

  return (
    <div className="relative aspect-square w-full max-w-[21rem]">
      <svg viewBox="0 0 100 100" className="h-full w-full" aria-hidden>
        {Array.from({ length: SEGMENTS }, (_, i) => {
          const on = lit.has(i);
          const isHead = i === ring.head;
          return (
            <rect
              key={i}
              x="48.9"
              y="1.5"
              width="2.2"
              height="7"
              rx="1.1"
              transform={`rotate(${(i / SEGMENTS) * 360} 50 50)`}
              fill={on ? color : "var(--color-led-off)"}
              opacity={on ? (isHead ? 1 : dimmed ? 0.35 : 0.7) : 1}
              style={on && isHead && !dimmed ? { filter: `drop-shadow(0 0 1.5px ${color})` } : undefined}
            />
          );
        })}
      </svg>
      <div className="absolute inset-[17%] flex items-center justify-center">{children}</div>
    </div>
  );
}
