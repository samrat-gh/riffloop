import { useEffect, useRef } from "react";

/** Calls `cb` on every animation frame while `active`. For UI only; audio timing lives on the audio clock. */
export function useFrame(cb: () => void, active = true): void {
  const ref = useRef(cb);
  useEffect(() => {
    ref.current = cb;
  });
  useEffect(() => {
    if (!active) return;
    let id = requestAnimationFrame(function frame() {
      ref.current();
      id = requestAnimationFrame(frame);
    });
    return () => cancelAnimationFrame(id);
  }, [active]);
}
