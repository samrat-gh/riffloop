import { useCallback, useEffect, useRef, useState } from "react";
import { describeError, LoopEngine } from "@/lib/audio/engine";
import { encodeWav } from "@/lib/audio/wav";
import { transition, type LooperAction, type LooperState } from "@/lib/looperState";
import { useFrame } from "./useFrame";

const COUNT_IN_KEY = "riffloop.countIn";
const DEVICE_KEY = "riffloop.deviceId";
const SPEAKER_KEY = "riffloop.speakerMode";
const ENHANCE_KEY = "riffloop.enhance";
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

/** Saves a WAV to the user's downloads. */
function downloadWav(channels: Float32Array[], sampleRate: number, name: string): void {
  const url = URL.createObjectURL(new Blob([encodeWav(channels, sampleRate)], { type: "audio/wav" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** e.g. "2026-09-24-2130", so exports sort by time and don't overwrite each other. */
const stamp = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
};

export function clampCountIn(n: number): number {
  return Number.isFinite(n) ? Math.min(30, Math.max(0, Math.round(n))) : 5;
}

export function useLooper() {
  const [engine, setEngine] = useState<LoopEngine | null>(null);
  const [state, setState] = useState<LooperState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [volumes, setVolumes] = useState<number[]>([]); // one per layer
  const layers = volumes.length;
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string | undefined>(() => load(DEVICE_KEY) ?? undefined);
  const [countIn, setCountInState] = useState(() => clampCountIn(Number(load(COUNT_IN_KEY) ?? 5)));
  const [speakerMode, setSpeakerModeState] = useState(() => load(SPEAKER_KEY) === "1");
  const [enhance, setEnhanceState] = useState(() => load(ENHANCE_KEY) === "1");
  const [confirmClear, setConfirmClear] = useState(false);
  const [starting, setStarting] = useState(false);
  const busy = useRef(false);
  const onInputLost = useRef<() => void>(() => {});
  const onOverdubEnd = useRef<() => void>(() => {});

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
      const e = await LoopEngine.create(load(DEVICE_KEY) ?? undefined, load(SPEAKER_KEY) === "1");
      e.onInputLost = () => onInputLost.current();
      e.onOverdubEnd = () => onOverdubEnd.current();
      e.setEnhance(load(ENHANCE_KEY) === "1");
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
        setVolumes(engine.layerVolumes());
        setState(ok ? "playing" : "idle");
      });
    }
  }, [engine, can, state, countIn, once]);

  const overdub = useCallback(() => {
    if (!engine || !can("overdub")) return;
    if (state === "playing") {
      engine.startOverdub(countIn);
      setState("overdubbing");
    } else {
      void once(async () => {
        await engine.stopOverdub();
        setVolumes(engine.layerVolumes());
        setState("playing");
      });
    }
  }, [engine, can, state, countIn, once]);

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
    setVolumes(engine.layerVolumes());
  }, [engine, can]);

  const clear = useCallback(() => {
    if (!engine || !can("clear")) return;
    if (!confirmClear) {
      setConfirmClear(true);
      return;
    }
    engine.clear();
    setVolumes([]);
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

  const setSpeakerMode = useCallback(
    (on: boolean) => {
      engine?.setSpeakerMode(on);
      setSpeakerModeState(on);
      save(SPEAKER_KEY, on ? "1" : "0");
    },
    [engine],
  );

  const setEnhance = useCallback(
    (on: boolean) => {
      engine?.setEnhance(on);
      setEnhanceState(on);
      save(ENHANCE_KEY, on ? "1" : "0");
    },
    [engine],
  );

  const [exporting, setExporting] = useState(false);

  /** The full loop as heard, stereo, one seamless loop long. */
  const exportMix = useCallback(async () => {
    if (!engine || !engine.layerCount() || exporting) return;
    setExporting(true);
    try {
      downloadWav(await engine.renderMix(), engine.sampleRate(), `riffloop-mix-${stamp()}.wav`);
    } catch (err) {
      setNotice(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setExporting(false);
    }
  }, [engine, exporting]);

  /** One layer on its own (a stem). All stems have the loop's length and line up when stacked. */
  const exportLayer = useCallback(
    (index: number) => {
      if (!engine || index >= engine.layerCount()) return;
      downloadWav([engine.layerAudio(index)], engine.sampleRate(), `riffloop-layer-${index + 1}-${stamp()}.wav`);
    },
    [engine],
  );

  const [importing, setImporting] = useState(false);

  /** Adds audio files as layers; with no loop yet, the first file becomes the loop. */
  const importFiles = useCallback(
    async (files: File[]) => {
      if (!engine || !files.length || importing) return;
      if (!can("import")) {
        setNotice("Finish the current recording before importing.");
        return;
      }
      setImporting(true);
      try {
        const { fitted } = await engine.importFiles(files);
        setVolumes(engine.layerVolumes());
        if (state === "idle") setState("stopped");
        setNotice(
          fitted.length
            ? `Fitted to the loop length (cut or padded with silence): ${fitted.join(", ")}`
            : null,
        );
      } catch (err) {
        setNotice(describeError(err));
      } finally {
        setImporting(false);
      }
    },
    [engine, importing, can, state],
  );

  const setVolume = useCallback(
    (index: number, volume: number) => {
      engine?.setLayerVolume(index, volume);
      setVolumes((v) => v.map((old, i) => (i === index ? volume : old)));
    },
    [engine],
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
    onOverdubEnd.current = () => {
      if (state === "overdubbing") overdub();
    };
  });

  return {
    engine,
    state,
    error,
    notice,
    layers,
    volumes,
    setVolume,
    exporting,
    importing,
    importFiles,
    exportMix,
    exportLayer,
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
    speakerMode,
    enhance,
    setEnhance,
    setSpeakerMode,
    dismissNotice: () => setNotice(null),
  };
}

export type Looper = ReturnType<typeof useLooper>;
