import { useCallback, useEffect, useRef, useState } from "react";
import { describeError, LoopEngine } from "@/lib/audio/engine";
import { transition, type LooperAction, type LooperState } from "@/lib/looperState";
import { useFrame } from "./useFrame";

const COUNT_IN_KEY = "riffloop.countIn";
const DEVICE_KEY = "riffloop.deviceId";
const CLEAR_CONFIRM_MS = 3000;

function load(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function save(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // storage unavailable (private mode etc.): the setting just isn't remembered
  }
}

export function clampCountIn(n: number): number {
  return Number.isFinite(n) ? Math.min(30, Math.max(0, Math.round(n))) : 5;
}

export function useLooper() {
  const [engine, setEngine] = useState<LoopEngine | null>(null);
  const [state, setState] = useState<LooperState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [layers, setLayers] = useState(0);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string | undefined>(() => load(DEVICE_KEY) ?? undefined);
  const [countIn, setCountInState] = useState(() => clampCountIn(Number(load(COUNT_IN_KEY) ?? 5)));
  const [confirmClear, setConfirmClear] = useState(false);
  const [starting, setStarting] = useState(false);
  const busy = useRef(false);
  const onInputLost = useRef<() => void>(() => {});

  const overdubs = Math.max(0, layers - 1);
  const can = useCallback(
    (action: LooperAction) => transition(state, action, { countIn, overdubs }) !== null,
    [state, countIn, overdubs],
  );

  const refreshDevices = useCallback(async (e: LoopEngine) => {
    setDevices(await e.listInputs());
    setDeviceId(e.currentDeviceId());
  }, []);

  const enable = useCallback(async () => {
    setStarting(true);
    setError(null);
    try {
      const e = await LoopEngine.create(load(DEVICE_KEY) ?? undefined);
      e.onInputLost = () => onInputLost.current();
      e.onDevicesChanged = () => void refreshDevices(e);
      setEngine(e);
      setState("idle");
      await refreshDevices(e); // labels are only available after permission
    } catch (err) {
      setError(describeError(err));
      setState("error");
    } finally {
      setStarting(false);
    }
  }, [refreshDevices]);

  /** Runs an async engine step once, ignoring presses while it is in flight. */
  const once = useCallback(async (fn: () => Promise<void>) => {
    if (busy.current) return;
    busy.current = true;
    try {
      await fn();
    } finally {
      busy.current = false;
    }
  }, []);

  const record = useCallback(() => {
    if (!engine || !can("record")) return;
    if (state === "idle") {
      engine.startRecording(countIn);
      setState(countIn > 0 ? "countdown" : "recording");
    } else if (state === "countdown") {
      engine.cancelRecording();
      setState("idle");
    } else if (state === "recording") {
      void once(async () => {
        const ok = await engine.stopRecording();
        setLayers(engine.layerCount());
        setState(ok ? "playing" : "idle");
      });
    }
  }, [engine, can, state, countIn, once]);

  const overdub = useCallback(() => {
    if (!engine || !can("overdub")) return;
    if (state === "playing") {
      engine.startOverdub();
      setState("overdubbing");
    } else {
      void once(async () => {
        await engine.stopOverdub();
        setLayers(engine.layerCount());
        setState("playing");
      });
    }
  }, [engine, can, state, once]);

  const play = useCallback(() => {
    if (!engine || !can("play")) return;
    engine.play();
    setState("playing");
  }, [engine, can]);

  const pause = useCallback(() => {
    if (!engine || !can("pause")) return;
    engine.pause();
    setState("paused");
  }, [engine, can]);

  const stop = useCallback(() => {
    if (!engine || !can("stop")) return;
    engine.stop();
    setState("stopped");
  }, [engine, can]);

  const undo = useCallback(() => {
    if (!engine || !can("undo")) return;
    engine.undo();
    setLayers(engine.layerCount());
  }, [engine, can]);

  const clear = useCallback(() => {
    if (!engine || !can("clear")) return;
    if (!confirmClear) {
      setConfirmClear(true);
      return;
    }
    engine.clear();
    setLayers(0);
    setConfirmClear(false);
    setState("idle");
  }, [engine, can, confirmClear]);

  useEffect(() => {
    if (!confirmClear) return;
    const t = setTimeout(() => setConfirmClear(false), CLEAR_CONFIRM_MS);
    return () => clearTimeout(t);
  }, [confirmClear]);

  const setCountIn = useCallback((n: number) => {
    const v = clampCountIn(n);
    setCountInState(v);
    save(COUNT_IN_KEY, String(v));
  }, []);

  const selectInput = useCallback(
    async (id: string) => {
      if (!engine) return;
      try {
        await engine.openInput(id);
        save(DEVICE_KEY, id);
        setNotice(null);
      } catch (err) {
        setNotice(describeError(err));
      }
      await refreshDevices(engine);
    },
    [engine, refreshDevices],
  );

  // Countdown finishes on the audio clock; the UI follows.
  useFrame(() => {
    if (engine && engine.countdownRemaining() <= 0) setState("recording");
  }, state === "countdown");

  // Input loss: end any take as if stopped, keep the loop playing.
  useEffect(() => {
    onInputLost.current = () => {
      setNotice("Input disconnected. Choose another input.");
      if (state === "countdown" || state === "recording") record();
      else if (state === "overdubbing") overdub();
    };
  });

  return {
    engine,
    state,
    error,
    notice,
    layers,
    devices,
    deviceId,
    countIn,
    confirmClear,
    starting,
    can,
    enable,
    record,
    overdub,
    play,
    pause,
    stop,
    undo,
    clear,
    setCountIn,
    selectInput,
    dismissNotice: () => setNotice(null),
  };
}

export type Looper = ReturnType<typeof useLooper>;
