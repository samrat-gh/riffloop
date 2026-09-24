"use client";

import { useState, type ReactNode } from "react";
import type { LoopEngine } from "@/lib/audio/engine";
import { useFrame } from "@/lib/hooks/useFrame";

const R = 45;
const C = 2 * Math.PI * R;

export function LoopProgress({
  engine,
  color,
  children,
}: {
  engine: LoopEngine | null;
  color: string;
  children: ReactNode;
}) {
  const [progress, setProgress] = useState(0);

  useFrame(() => {
    const dur = engine?.loopDuration() ?? 0;
    setProgress(dur ? engine!.position() / dur : 0);
  });

  return (
    <div className="relative aspect-square w-full max-w-80">
      <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
        <circle cx="50" cy="50" r={R} fill="none" strokeWidth="4" className="stroke-zinc-800" />
        <circle
          cx="50"
          cy="50"
          r={R}
          fill="none"
          strokeWidth="4"
          strokeLinecap="round"
          stroke={color}
          strokeDasharray={C}
          strokeDashoffset={C * (1 - progress)}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">{children}</div>
    </div>
  );
}
