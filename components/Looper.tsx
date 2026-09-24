"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { LevelMeter } from "@/components/LevelMeter";
import { LoopProgress } from "@/components/LoopProgress";
import { useFrame } from "@/lib/hooks/useFrame";
import { useLooper, type Looper as LooperApi } from "@/lib/hooks/useLooper";
import type { LooperState } from "@/lib/looperState";

const HEADPHONES_KEY = "riffloop.headphonesNoteDismissed";

const STATE_COLOR: Record<LooperState, string> = {
  idle: "#52525b",
  countdown: "#ef4444",
  recording: "#ef4444",
  playing: "#10b981",
  overdubbing: "#f59e0b",
  paused: "#a1a1aa",
  stopped: "#a1a1aa",
  error: "#ef4444",
};

const fmt = (sec: number) => {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${String(m).padStart(2, "0")}:${s.toFixed(1).padStart(4, "0")}`;
};

function Live({ get }: { get: () => string }) {
  const [text, setText] = useState(get);
  useFrame(() => setText(get()));
  return <>{text}</>;
}

function Btn({
  onClick,
  children,
  hint,
  tone = "neutral",
  big = false,
}: {
  onClick: () => void;
  children: ReactNode;
  hint?: string;
  tone?: "neutral" | "record" | "overdub" | "play" | "danger";
  big?: boolean;
}) {
  const tones = {
    neutral: "bg-zinc-800 hover:bg-zinc-700 text-zinc-100",
    record: "bg-red-600 hover:bg-red-500 text-white",
    overdub: "bg-amber-500 hover:bg-amber-400 text-zinc-950",
    play: "bg-emerald-600 hover:bg-emerald-500 text-white",
    danger: "bg-red-900 hover:bg-red-800 text-red-100 ring-2 ring-red-500",
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col items-center justify-center rounded-2xl font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-100 ${tones[tone]} ${big ? "min-h-24 min-w-44 px-8 text-2xl" : "min-h-16 min-w-28 px-5 text-lg"}`}
    >
      {children}
      {hint && <span className="mt-1 text-xs font-normal opacity-60">{hint}</span>}
    </button>
  );
}

function Status({ l }: { l: LooperApi }) {
  const e = l.engine!;
  switch (l.state) {
    case "countdown":
      return (
        <>
          <span className="text-8xl font-bold tabular-nums text-red-500">
            <Live get={() => String(Math.ceil(e.countdownRemaining()))} />
          </span>
          <span className="mt-2 text-zinc-400">Recording starts in…</span>
        </>
      );
    case "recording":
      return (
        <>
          <span className="text-xl font-semibold text-red-500">● Recording</span>
          <span className="mt-2 text-4xl font-bold tabular-nums">
            <Live get={() => fmt(e.recordingElapsed())} />
          </span>
        </>
      );
    case "overdubbing":
      return (
        <>
          <span className="text-xl font-semibold text-amber-400">● Overdubbing</span>
          <span className="mt-2 text-4xl font-bold">Layer {l.layers + 1}</span>
        </>
      );
    case "playing":
    case "paused":
    case "stopped":
      return (
        <>
          <span className="text-xl font-semibold text-zinc-300">
            {l.state === "playing" ? "▶ Playing" : l.state === "paused" ? "❚❚ Paused" : "■ Stopped"}
          </span>
          <span className="mt-2 text-4xl font-bold tabular-nums">{fmt(e.loopDuration())}</span>
          <span className="mt-1 text-sm text-zinc-500">
            {l.layers} {l.layers === 1 ? "layer" : "layers"}
          </span>
        </>
      );
    default:
      return (
        <>
          <span className="text-xl font-semibold text-zinc-300">Ready</span>
          <span className="mt-2 text-sm text-zinc-500">Press Record to start a loop</span>
        </>
      );
  }
}

function Controls({ l }: { l: LooperApi }) {
  const undo = l.can("undo") && <Btn onClick={l.undo} hint="Z">Undo</Btn>;
  const clear = l.can("clear") && (
    <Btn onClick={l.clear} hint="C" tone={l.confirmClear ? "danger" : "neutral"}>
      {l.confirmClear ? "Confirm clear" : "Clear"}
    </Btn>
  );

  switch (l.state) {
    case "idle":
      return <Btn onClick={l.record} hint="R" tone="record" big>● Record</Btn>;
    case "countdown":
      return <Btn onClick={l.record} hint="R">Cancel</Btn>;
    case "recording":
      return <Btn onClick={l.record} hint="R" tone="record" big>■ Stop / Create loop</Btn>;
    case "overdubbing":
      return <Btn onClick={l.overdub} hint="O" tone="overdub" big>■ Stop overdub</Btn>;
    case "playing":
      return (
        <>
          <Btn onClick={l.overdub} hint="O" tone="overdub" big>● Overdub</Btn>
          <Btn onClick={l.pause} hint="Space">❚❚ Pause</Btn>
          <Btn onClick={l.stop}>■ Stop</Btn>
          {undo}
          {clear}
        </>
      );
    case "paused":
    case "stopped":
      return (
        <>
          <Btn onClick={l.play} hint="Space" tone="play" big>▶ Play</Btn>
          {undo}
          {clear}
        </>
      );
    default:
      return null;
  }
}

function CountInSelect({ l }: { l: LooperApi }) {
  const preset = l.countIn === 5 || l.countIn === 10;
  const [custom, setCustom] = useState(!preset);
  const disabled = l.state !== "idle";
  return (
    <label className="flex items-center gap-2 text-sm text-zinc-400">
      Count-in
      <select
        disabled={disabled}
        value={custom ? "custom" : String(l.countIn)}
        onChange={(ev) => {
          if (ev.target.value === "custom") return setCustom(true);
          setCustom(false);
          l.setCountIn(Number(ev.target.value));
        }}
        className="rounded-lg bg-zinc-800 px-2 py-1.5 text-zinc-100 disabled:opacity-50"
      >
        <option value="5">5 s</option>
        <option value="10">10 s</option>
        <option value="custom">Custom</option>
      </select>
      {custom && (
        <input
          type="number"
          min={0}
          max={30}
          step={1}
          disabled={disabled}
          defaultValue={l.countIn}
          onChange={(ev) => ev.target.value !== "" && l.setCountIn(Number(ev.target.value))}
          aria-label="Custom count-in seconds"
          className="w-16 rounded-lg bg-zinc-800 px-2 py-1.5 text-zinc-100 disabled:opacity-50"
        />
      )}
    </label>
  );
}

function InputSelect({ l }: { l: LooperApi }) {
  const busy = l.state === "countdown" || l.state === "recording" || l.state === "overdubbing";
  return (
    <select
      aria-label="Audio input"
      disabled={busy}
      value={l.deviceId ?? ""}
      onChange={(ev) => void l.selectInput(ev.target.value)}
      className="min-w-0 flex-1 truncate rounded-lg bg-zinc-800 px-3 py-2 text-sm text-zinc-100 disabled:opacity-50"
    >
      {l.devices.map((d, i) => (
        <option key={d.deviceId} value={d.deviceId}>
          {d.label || `Input ${i + 1}`}
        </option>
      ))}
    </select>
  );
}

function useKeyboard(l: LooperApi) {
  const ref = useRef(l);
  useEffect(() => {
    ref.current = l;
  });
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const t = ev.target as HTMLElement | null;
      if (ev.metaKey || ev.ctrlKey || ev.altKey || ev.repeat) return;
      if (t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA" || t.isContentEditable))
        return;
      const a = ref.current;
      const actions: Record<string, () => void> = {
        " ": () => (a.state === "playing" ? a.pause() : a.play()),
        r: a.record,
        o: a.overdub,
        z: a.undo,
        c: a.clear,
      };
      const fn = actions[ev.key.toLowerCase()];
      if (!fn) return;
      ev.preventDefault(); // stops Space from also clicking the focused button
      fn(); // each action ignores itself when not valid in the current state
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

function HeadphonesNote() {
  const [show, setShow] = useState(() => {
    try {
      return localStorage.getItem(HEADPHONES_KEY) !== "1";
    } catch {
      return true;
    }
  });
  if (!show) return null;
  return (
    <p className="flex items-start gap-3 rounded-xl bg-zinc-900 px-4 py-3 text-sm text-zinc-400">
      <span className="flex-1">
        Tip: use headphones. With a microphone and speakers, the loop leaks into your overdubs.
      </span>
      <button
        type="button"
        className="text-zinc-500 hover:text-zinc-200"
        aria-label="Dismiss tip"
        onClick={() => {
          setShow(false);
          try {
            localStorage.setItem(HEADPHONES_KEY, "1");
          } catch {}
        }}
      >
        ✕
      </button>
    </p>
  );
}

export default function Looper() {
  const l = useLooper();
  useKeyboard(l);

  if (!l.engine) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-6 px-4 text-center">
        <h1 className="text-5xl font-bold tracking-tight">RiffLoop</h1>
        <p className="max-w-md text-zinc-400">
          Record a phrase, let it loop, layer more on top. Connect a microphone or audio interface to begin.
        </p>
        <Btn onClick={() => void l.enable()} tone="record" big>
          {l.starting ? "Starting…" : l.error ? "Try again" : "Enable audio"}
        </Btn>
        {l.error && <p role="alert" className="max-w-md text-red-400">{l.error}</p>}
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-6">
      <header className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-bold tracking-tight">RiffLoop</h1>
          <InputSelect l={l} />
        </div>
        <LevelMeter engine={l.engine} />
        {l.notice && (
          <p role="alert" className="flex gap-3 rounded-xl bg-red-950 px-4 py-2 text-sm text-red-200">
            <span className="flex-1">{l.notice}</span>
            <button type="button" onClick={l.dismissNotice} aria-label="Dismiss">✕</button>
          </p>
        )}
      </header>

      <section className="flex flex-1 flex-col items-center justify-center gap-8">
        <LoopProgress engine={l.engine} color={STATE_COLOR[l.state]}>
          <Status l={l} />
        </LoopProgress>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Controls l={l} />
        </div>
      </section>

      <footer className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CountInSelect l={l} />
          <span className="text-xs text-zinc-600">Space play/pause · R record · O overdub · Z undo · C clear</span>
        </div>
        <HeadphonesNote />
      </footer>
    </main>
  );
}
