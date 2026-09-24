"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { LevelMeter } from "@/components/LevelMeter";
import { LoopProgress, STATE_COLOR } from "@/components/LoopProgress";
import { useFrame } from "@/lib/hooks/useFrame";
import { useLooper, type Looper as LooperApi } from "@/lib/hooks/useLooper";

const fmt = (sec: number) => {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${String(m).padStart(2, "0")}:${s.toFixed(1).padStart(4, "0")}`;
};

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-current/30 px-1 font-label text-[0.7rem] leading-4 font-medium opacity-70">
      {children}
    </kbd>
  );
}

/** The big chrome switch in the middle of the ring: always the one main action. */
function Footswitch({
  onClick,
  label,
  sub,
  hint,
  big,
}: {
  onClick: () => void;
  label: string;
  sub?: string;
  hint?: string;
  big?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex aspect-square w-full flex-col items-center justify-center gap-1 rounded-full text-case shadow-[0_6px_0_#0a1113,0_10px_24px_rgba(0,0,0,0.5),inset_0_2px_0_rgba(255,255,255,0.7),inset_0_-3px_6px_rgba(0,0,0,0.25)] transition-transform select-none focus-visible:outline-4 focus-visible:outline-offset-4 focus-visible:outline-silk active:translate-y-1 active:shadow-[0_2px_0_#0a1113,0_4px_12px_rgba(0,0,0,0.5),inset_0_2px_0_rgba(255,255,255,0.7)]"
      style={{ background: "radial-gradient(circle at 35% 30%, #f4f5f2 0%, #c9cfcc 45%, #8e9896 100%)" }}
    >
      <span className={`font-label leading-none font-bold ${big ? "text-7xl tabular-nums" : "text-3xl"}`}>{label}</span>
      {sub && <span className="font-label text-base leading-tight font-medium opacity-70">{sub}</span>}
      {hint && <Kbd>{hint}</Kbd>}
    </button>
  );
}

function MainSwitch({ l }: { l: LooperApi }) {
  const e = l.engine!;
  switch (l.state) {
    case "idle":
      return <Footswitch onClick={l.record} label="Record" hint="R" />;
    case "countdown":
      return (
        <Footswitch
          onClick={l.record}
          label={String(Math.max(1, Math.ceil(e.countdownRemaining())))}
          sub="Cancel"
          hint="R"
          big
        />
      );
    case "recording":
      return <Footswitch onClick={l.record} label="Stop" sub="Create loop" hint="R" />;
    case "playing":
      return <Footswitch onClick={l.overdub} label="Overdub" hint="O" />;
    case "overdubbing":
      return e.countdownRemaining() > 0 ? (
        <Footswitch
          onClick={l.overdub}
          label={String(Math.ceil(e.countdownRemaining()))}
          sub="Cancel"
          hint="O"
          big
        />
      ) : (
        <Footswitch onClick={l.overdub} label="Stop" sub="Ends by itself" hint="O" />
      );
    default:
      return <Footswitch onClick={l.play} label="Play" hint="Space" />;
  }
}

/** Re-renders every frame while a take is counting in or running, so timers stay live. */
function useLiveTake(l: LooperApi) {
  const [, setTick] = useState(0);
  useFrame(() => setTick((t) => t + 1), l.state === "countdown" || l.state === "recording" || l.state === "overdubbing");
}

function LiveSwitch({ l }: { l: LooperApi }) {
  useLiveTake(l);
  return <MainSwitch l={l} />;
}

function Display({ l }: { l: LooperApi }) {
  useLiveTake(l);
  const e = l.engine!;
  const preRoll = l.state === "overdubbing" && e.countdownRemaining() > 0;
  const idleDot = l.state === "idle" || l.state === "paused" || l.state === "stopped";
  const dot = idleDot ? "var(--color-dim)" : STATE_COLOR[l.state];
  const names = {
    idle: "Ready",
    countdown: "Get ready",
    recording: "Recording",
    playing: "Playing",
    overdubbing: preRoll ? `Layer ${l.layers + 1} starts in` : `Overdubbing layer ${l.layers + 1}`,
    paused: "Paused",
    stopped: "Stopped",
    error: "Error",
  };
  const loop = l.layers > 0 ? fmt(e.loopDuration()) : "--:--.-";
  const layers = l.layers === 0 ? "No loop yet" : l.layers === 1 ? "1 layer" : `${l.layers} layers`;
  const [time, timeLabel, footnote] =
    l.state === "recording"
      ? [fmt(e.recordingElapsed()), "Elapsed", layers]
      : preRoll
        ? [fmt(e.countdownRemaining()), "Count-in", `Loop ${loop}`]
        : l.state === "overdubbing"
          ? [fmt(e.overdubRemaining()), "Time left", `Loop ${loop}`]
          : [loop, "Loop length", layers];

  return (
    <div className="grid w-full grid-cols-[1fr_auto] items-center gap-x-4 rounded-xl bg-window px-4 py-3 shadow-[inset_0_2px_6px_rgba(0,0,0,0.6)]">
      <span className="flex items-center gap-2 font-label text-xl font-semibold" aria-live="polite">
        <span
          className="size-2.5 rounded-full"
          style={{ background: dot, boxShadow: idleDot ? undefined : `0 0 8px ${dot}` }}
        />
        {names[l.state]}
      </span>
      <span className="font-label text-2xl font-semibold tabular-nums">{time}</span>
      <span className="text-sm text-dim">{footnote}</span>
      <span className="text-right text-sm text-dim">{timeLabel}</span>
    </div>
  );
}

function SmallBtn({
  onClick,
  children,
  hint,
  danger,
}: {
  onClick: () => void;
  children: ReactNode;
  hint?: string;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-h-12 items-center justify-center gap-2 rounded-xl border px-4 font-label text-lg font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-silk ${
        danger
          ? "border-rec bg-rec text-case hover:brightness-110"
          : "border-case-edge bg-case text-silk hover:border-dim"
      }`}
    >
      {children}
      {hint && <Kbd>{hint}</Kbd>}
    </button>
  );
}

function SecondaryControls({ l }: { l: LooperApi }) {
  return (
    <div className="grid min-h-12 w-full grid-cols-2 gap-2 [&>*:last-child:nth-child(odd)]:col-span-2">
      {l.can("pause") && <SmallBtn onClick={l.pause} hint="Space">Pause</SmallBtn>}
      {l.can("stop") && <SmallBtn onClick={l.stop}>Stop</SmallBtn>}
      {l.can("undo") && <SmallBtn onClick={l.undo} hint="Z">Undo layer</SmallBtn>}
      {l.can("clear") && (
        <SmallBtn onClick={l.clear} hint="C" danger={l.confirmClear}>
          {l.confirmClear ? "Press again to clear" : "Clear"}
        </SmallBtn>
      )}
    </div>
  );
}

function CountInSelect({ l }: { l: LooperApi }) {
  const [custom, setCustom] = useState(l.countIn !== 5 && l.countIn !== 10);
  const disabled = l.state !== "idle";
  const option = (active: boolean, label: string, onClick: () => void) => (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={active}
      onClick={onClick}
      className={`rounded-lg px-3 py-1.5 font-label text-base font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-silk disabled:opacity-40 ${
        active ? "bg-silk text-case" : "text-dim hover:text-silk"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="font-label text-base font-medium text-dim">Count-in</span>
      <div className="flex rounded-xl bg-window p-1" role="group" aria-label="Count-in length">
        {option(!custom && l.countIn === 5, "5 s", () => (setCustom(false), l.setCountIn(5)))}
        {option(!custom && l.countIn === 10, "10 s", () => (setCustom(false), l.setCountIn(10)))}
        {option(custom, "Custom", () => setCustom(true))}
      </div>
      {custom && (
        <label className="flex items-center gap-2 text-sm text-dim">
          <input
            type="number"
            min={0}
            max={30}
            step={1}
            disabled={disabled}
            defaultValue={l.countIn}
            onChange={(ev) => ev.target.value !== "" && l.setCountIn(Number(ev.target.value))}
            className="w-16 rounded-lg border border-case-edge bg-window px-2 py-1.5 font-label text-base text-silk disabled:opacity-40"
          />
          seconds (0–30)
        </label>
      )}
    </div>
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
      className="min-w-0 flex-1 truncate rounded-xl border border-case-edge bg-window px-3 py-2 text-sm text-silk disabled:opacity-40 sm:flex-none sm:max-w-72"
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

const panelBtn =
  "rounded-xl border border-case-edge bg-case px-3 py-1.5 font-label text-base font-semibold text-silk hover:border-dim focus-visible:outline-2 focus-visible:outline-silk disabled:opacity-50";

/** One row per layer: volume, and a download of that layer on its own. Plus import and the whole mix. */
function LayerMixer({ l }: { l: LooperApi }) {
  const fileInput = useRef<HTMLInputElement>(null);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="font-label text-base font-medium text-dim">Layers</span>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            disabled={l.importing || !l.can("import")}
            className={panelBtn}
          >
            {l.importing ? "Importing…" : "Import audio"}
          </button>
          {l.layers > 0 && (
            <button type="button" onClick={() => void l.exportMix()} disabled={l.exporting} className={panelBtn}>
              {l.exporting ? "Exporting…" : "Export mix (WAV)"}
            </button>
          )}
        </div>
        <input
          ref={fileInput}
          type="file"
          accept="audio/*"
          multiple
          hidden
          onChange={(ev) => {
            void l.importFiles([...(ev.target.files ?? [])]);
            ev.target.value = ""; // allow importing the same file again
          }}
        />
      </div>
      {l.layers === 0 && (
        <p className="text-sm text-dim">
          Import an audio file to use it as your loop, or drop files anywhere on the page. You can also add files to an
          existing loop as extra layers.
        </p>
      )}
      {l.volumes.map((v, i) => (
        <div key={i} className="grid grid-cols-[4.5rem_1fr_3rem_auto] items-center gap-3">
          <span className="font-label text-base font-semibold">Layer {i + 1}</span>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={Math.round(v * 100)}
            onChange={(ev) => l.setVolume(i, Number(ev.target.value) / 100)}
            aria-label={`Layer ${i + 1} volume`}
            className="w-full accent-silk"
          />
          <span className="text-right font-label text-base tabular-nums text-dim">{Math.round(v * 100)}%</span>
          <button
            type="button"
            onClick={() => l.exportLayer(i)}
            aria-label={`Download layer ${i + 1} as WAV`}
            title={`Download layer ${i + 1}`}
            className="rounded-lg px-2 py-1 font-label text-sm font-semibold text-dim hover:text-silk focus-visible:outline-2 focus-visible:outline-silk"
          >
            WAV ↓
          </button>
        </div>
      ))}
      <p className="text-sm text-dim">
        While you overdub, the other layers play quieter so you can hear yourself. Layer downloads all have the
        loop&apos;s length, so they line up when stacked in any audio editor.
      </p>
    </div>
  );
}

/** Enhance on/off. Works on the stored raw takes, so it can be flipped any time outside a take. */
function EnhanceSelect({ l }: { l: LooperApi }) {
  const busy = l.state === "countdown" || l.state === "recording" || l.state === "overdubbing";
  const option = (on: boolean, label: string) => (
    <button
      type="button"
      disabled={busy}
      aria-pressed={l.enhance === on}
      onClick={() => l.setEnhance(on)}
      className={`rounded-lg px-3 py-1.5 font-label text-base font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-silk disabled:opacity-40 ${
        l.enhance === on ? "bg-silk text-case" : "text-dim hover:text-silk"
      }`}
    >
      {label}
    </button>
  );
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-label text-base font-medium text-dim">Enhance</span>
        <div className="flex rounded-xl bg-window p-1" role="group" aria-label="Enhance">
          {option(false, "Off")}
          {option(true, "On")}
        </div>
      </div>
      <p className="text-sm text-dim">
        {l.enhance
          ? "Background noise turned down, layers matched in level, light compression and room reverb. Your original takes are kept."
          : "You hear exactly what was recorded. Turn on to reduce background noise and polish the sound."}
      </p>
    </div>
  );
}

/** Headphones vs speakers. Speakers turn on echo cancellation so the loop doesn't leak into overdubs. */
function MonitorSelect({ l }: { l: LooperApi }) {
  const busy = l.state === "countdown" || l.state === "recording" || l.state === "overdubbing";
  const option = (on: boolean, label: string) => (
    <button
      type="button"
      disabled={busy}
      aria-pressed={l.speakerMode === on}
      onClick={() => l.setSpeakerMode(on)}
      className={`rounded-lg px-3 py-1.5 font-label text-base font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-silk disabled:opacity-40 ${
        l.speakerMode === on ? "bg-silk text-case" : "text-dim hover:text-silk"
      }`}
    >
      {label}
    </button>
  );
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-label text-base font-medium text-dim">Listening on</span>
        <div className="flex rounded-xl bg-window p-1" role="group" aria-label="Listening on">
          {option(false, "Headphones")}
          {option(true, "Speakers")}
        </div>
      </div>
      <p className="text-sm text-dim">
        {l.speakerMode
          ? "After each overdub, the loop that leaked from your speakers into the mic is removed from the new layer. Headphones are still the cleanest."
          : "Takes are kept exactly as recorded. If you hear the loop from speakers, switch to Speakers so it doesn't pile up in your overdubs."}
      </p>
    </div>
  );
}

function Pedal({ children }: { children: ReactNode }) {
  return (
    <section className="flex w-full flex-col items-center gap-6 rounded-[2rem] border border-case-edge bg-case px-5 pt-7 pb-6 shadow-[0_30px_60px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.06)] sm:px-8">
      {children}
    </section>
  );
}

/** Dropping audio files anywhere on the page imports them as layers. */
function useFileDrop(l: LooperApi) {
  const ref = useRef(l);
  useEffect(() => {
    ref.current = l;
  });
  useEffect(() => {
    const over = (ev: DragEvent) => {
      if (ev.dataTransfer?.types.includes("Files")) ev.preventDefault();
    };
    const drop = (ev: DragEvent) => {
      if (!ev.dataTransfer?.files.length) return;
      ev.preventDefault();
      void ref.current.importFiles([...ev.dataTransfer.files]);
    };
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  }, []);
}

export default function Looper() {
  const l = useLooper();
  useKeyboard(l);
  useFileDrop(l);

  const wordmark = <h1 className="font-label text-2xl font-bold italic tracking-tight">RiffLoop</h1>;

  if (!l.engine) {
    return (
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-5 px-4 py-8">
        <Pedal>
          <div className="self-start">{wordmark}</div>
          <LoopProgress engine={null} state="idle" countIn={0}>
            <Footswitch onClick={() => void l.enable()} label={l.starting ? "Starting" : "Start"} />
          </LoopProgress>
          <div className="w-full rounded-xl bg-window px-4 py-3 text-sm shadow-[inset_0_2px_6px_rgba(0,0,0,0.6)]">
            {l.error ? (
              <p role="alert" className="text-rec">{l.error}</p>
            ) : (
              <p className="text-dim">
                Press Start to connect your microphone or audio interface. Your browser will ask for permission.
              </p>
            )}
          </div>
        </Pedal>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-5 px-4 py-8">
      <Pedal>
        <div className="flex w-full items-center justify-between gap-3">
          {wordmark}
          <InputSelect l={l} />
        </div>
        <div className="w-full">
          <LevelMeter engine={l.engine} />
        </div>
        {l.notice && (
          <p role="alert" className="flex w-full gap-3 rounded-xl border border-rec/60 px-4 py-2 text-sm text-silk">
            <span className="flex-1">{l.notice}</span>
            <button type="button" onClick={l.dismissNotice} aria-label="Dismiss" className="hover:text-rec">✕</button>
          </p>
        )}
        <LoopProgress engine={l.engine} state={l.state} countIn={l.countIn}>
          <LiveSwitch l={l} />
        </LoopProgress>
        <Display l={l} />
        <SecondaryControls l={l} />
      </Pedal>
      <div className="flex flex-col gap-4 px-1">
        <EnhanceSelect l={l} />
        <LayerMixer l={l} />
        <CountInSelect l={l} />
        <MonitorSelect l={l} />
      </div>
    </main>
  );
}
