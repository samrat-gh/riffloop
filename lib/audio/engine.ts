import { fadeAt, fadeEdges, writeWrapped } from "./buffer";

const MIN_LOOP_SEC = 0.5;
const FADE_SEC = 0.005;
const START_LEAD_SEC = 0.03; // schedule playback slightly ahead so all layers start together
const FLUSH_MS = 60; // wait for in-flight worklet blocks after a stop press
const OUTPUT_GAIN = 0.8; // headroom for summed layers
// ponytail: fixed duck level; make it a setting if players want it louder or quieter.
const DUCK = 0.45; // existing layers play at this level while an overdub records, so the new part stands out and less loop leaks into a mic
// Browsers don't report input latency reliably. ponytail: fixed estimate; a per-device calibration setting is the upgrade.
const INPUT_LATENCY_SEC = 0.01;
const PREVIEW_SEC = 0.15; // schedule the new layer this long before an overdub auto-ends

interface Block {
  frame: number;
  samples: Float32Array;
}

/** A recorded layer and its own volume control. */
interface Layer {
  buffer: AudioBuffer;
  gain: GainNode;
}

interface Overdub {
  layer: Float32Array<ArrayBuffer>;
  /** Capture frames [startFrame, endFrame) are shifted by `latency` from the loop positions they belong to. */
  startFrame: number;
  endFrame: number;
  latency: number;
  firstPos: number | null;
  lastPos: number;
  gain: GainNode; // shared by the preview and the finished layer, so a volume set early carries over
  previewed: boolean;
  ended: boolean;
}

export class EngineError extends Error {}

/** User-facing message for anything thrown while opening audio or input. */
export function describeError(e: unknown): string {
  if (e instanceof EngineError) return e.message;
  const name = e instanceof DOMException ? e.name : "";
  if (name === "NotAllowedError")
    return "Microphone access was denied. Allow it in your browser's site settings, then try again.";
  if (name === "NotFoundError" || name === "OverconstrainedError")
    return "No audio input found. Connect a microphone or audio interface, then try again.";
  if (name === "NotReadableError")
    return "The audio input is busy or unavailable. Close other apps using it, then try again.";
  return `Audio could not start: ${e instanceof Error ? e.message : String(e)}`;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const mod = (a: number, n: number) => ((a % n) + n) % n;

export class LoopEngine {
  onInputLost?: () => void;
  onDevicesChanged?: () => void;
  /** Fired when an overdub reaches one full loop pass; the caller should then call stopOverdub(). */
  onOverdubEnd?: () => void;

  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private readonly meterData: Float32Array<ArrayBuffer>;

  private layers: Layer[] = [];
  private sources: AudioBufferSourceNode[] = [];
  private loopStart = 0; // audio time at which loop position 0 played
  private offset = 0; // loop position kept while paused/stopped

  private ticks: OscillatorNode[] = [];
  private recStart = 0;
  private masterBlocks: Block[] = [];
  private mode: "none" | "master" | "overdub" = "none";
  private od: Overdub | null = null;

  private constructor(
    private readonly ctx: AudioContext,
    private readonly capture: AudioWorkletNode,
    private readonly analyser: AnalyserNode,
    private readonly out: GainNode,
  ) {
    this.meterData = new Float32Array(analyser.fftSize);
    capture.port.onmessage = (e: MessageEvent<Block>) => this.onBlock(e.data);
    navigator.mediaDevices.addEventListener("devicechange", () => this.onDevicesChanged?.());
  }

  /**
   * Speakers mode: turns on the browser's echo cancellation, which removes RiffLoop's own playback
   * from the input so the loop does not leak into overdubs. Costs some tone, so it is off for headphones.
   */
  private speakerMode = false;

  /** Must be called from a user gesture (autoplay rules). */
  static async create(deviceId?: string, speakerMode = false): Promise<LoopEngine> {
    if (!window.isSecureContext)
      throw new EngineError("RiffLoop needs a secure connection (HTTPS or localhost) to use the microphone.");
    if (!navigator.mediaDevices?.getUserMedia || typeof AudioWorkletNode === "undefined")
      throw new EngineError("This browser does not support the audio features RiffLoop needs. Try current Chrome, Edge, Firefox, or Safari.");

    const ctx = new AudioContext({ latencyHint: "interactive" });
    try {
      void ctx.resume();
      await ctx.audioWorklet.addModule("/worklets/capture.js");
      // The worklet outputs silence; connecting it to the destination keeps it processing.
      const capture = new AudioWorkletNode(ctx, "capture");
      capture.connect(ctx.destination);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      const out = ctx.createGain();
      out.gain.value = OUTPUT_GAIN;
      out.connect(ctx.destination);

      const engine = new LoopEngine(ctx, capture, analyser, out);
      engine.speakerMode = speakerMode;
      try {
        await engine.openInput(deviceId);
      } catch (e) {
        // A remembered device may be gone; fall back to the default input.
        if (!deviceId) throw e;
        await engine.openInput();
      }
      return engine;
    } catch (e) {
      void ctx.close();
      throw e;
    }
  }

  // ---- input ----

  async openInput(deviceId?: string): Promise<void> {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: this.speakerMode,
        noiseSuppression: false,
        autoGainControl: false,
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      },
    });
    this.stream?.getTracks().forEach((t) => t.stop());
    this.source?.disconnect();

    this.stream = stream;
    this.source = this.ctx.createMediaStreamSource(stream);
    this.source.connect(this.capture);
    this.source.connect(this.analyser); // meter only, never to the output
    const track = stream.getAudioTracks()[0];
    // "ended" fires only when the device goes away, not when we stop() the track ourselves.
    track.addEventListener("ended", () => this.onInputLost?.());
  }

  /** Reopens the current input with echo cancellation on (speakers) or off (headphones). */
  async setSpeakerMode(on: boolean): Promise<void> {
    this.speakerMode = on;
    await this.openInput(this.currentDeviceId());
  }

  currentDeviceId(): string | undefined {
    return this.stream?.getAudioTracks()[0]?.getSettings().deviceId;
  }

  async listInputs(): Promise<MediaDeviceInfo[]> {
    const all = await navigator.mediaDevices.enumerateDevices();
    return all.filter((d) => d.kind === "audioinput");
  }

  /** Peak input level, 0..1+ (≥1 means clipping). */
  inputPeak(): number {
    this.analyser.getFloatTimeDomainData(this.meterData);
    let peak = 0;
    for (const v of this.meterData) peak = Math.max(peak, Math.abs(v));
    return peak;
  }

  // ---- master recording ----

  /** Starts the count-in (if any), then records from the end of it. */
  startRecording(countIn: number): void {
    this.countIn(countIn);
    this.masterBlocks = [];
    this.setCapture("master");
  }

  /** Schedules count-in ticks; the take (master or overdub) starts when they end. */
  private countIn(seconds: number): void {
    const t0 = this.ctx.currentTime + (seconds > 0 ? 0.05 : 0);
    for (let i = 0; i < seconds; i++) this.ticks.push(this.tick(t0 + i, i === seconds - 1));
    this.recStart = t0 + seconds;
  }

  /** Seconds left in the count-in of the current take (master or overdub). */
  countdownRemaining(): number {
    return Math.max(0, this.recStart - this.ctx.currentTime);
  }

  /** Seconds recorded so far in the current take (master or overdub). */
  recordingElapsed(): number {
    return Math.max(0, this.ctx.currentTime - this.recStart);
  }

  /** Round trip in frames: scheduled playback → speakers → player → input → capture. */
  private latencyFrames(): number {
    const out = (this.ctx.baseLatency || 0) + (this.ctx.outputLatency || 0); // either can be missing in some browsers
    return Math.round((out + INPUT_LATENCY_SEC) * this.ctx.sampleRate);
  }

  private unduck(): void {
    const g = this.out.gain;
    g.cancelScheduledValues(this.ctx.currentTime);
    g.setTargetAtTime(OUTPUT_GAIN, this.ctx.currentTime, 0.02);
  }

  private stopTicks(): void {
    this.ticks.forEach((t) => t.stop());
    this.ticks = [];
  }

  cancelRecording(): void {
    this.stopTicks();
    this.setCapture("none");
  }

  /** Ends the master recording and starts looping. Returns false if it was too short. */
  async stopRecording(): Promise<boolean> {
    const stopTime = this.ctx.currentTime;
    const sr = this.ctx.sampleRate;
    const len = Math.round((stopTime - this.recStart) * sr);
    this.ticks = [];
    await wait(FLUSH_MS);
    this.setCapture("none");
    if (len < MIN_LOOP_SEC * sr) return false;

    const data = new Float32Array(len);
    const start = Math.round(this.recStart * sr);
    for (const { frame, samples } of this.masterBlocks) {
      const p = frame - start;
      if (p >= len) break;
      data.set(samples.subarray(0, len - p), p);
    }
    this.masterBlocks = [];
    fadeEdges(data, Math.round(FADE_SEC * sr));

    this.layers = [{ buffer: this.toBuffer(data), gain: this.layerGain() }];
    // Loop position 0 is the moment Record was pressed to stop, like a pedal.
    this.startSources(this.layers, stopTime);
    return true;
  }

  // ---- overdub ----

  /**
   * Starts an overdub. With a count-in, the loop stops, the ticks play alone, and the loop restarts
   * from the top exactly when recording begins. Without one, recording starts at once over the playing loop.
   * It ends by itself after exactly one loop pass, so the player never has to let go of the guitar.
   */
  startOverdub(countIn: number): void {
    const len = this.layers[0].buffer.length;
    if (countIn > 0) this.stopSources();
    this.countIn(countIn);
    if (countIn > 0) this.startSources(this.layers, this.recStart, this.recStart);
    // Duck the playing layers for exactly the recorded pass, on the audio clock.
    const g = this.out.gain;
    g.cancelScheduledValues(this.ctx.currentTime);
    g.setTargetAtTime(OUTPUT_GAIN * DUCK, this.recStart, 0.03);
    g.setTargetAtTime(OUTPUT_GAIN, this.recStart + this.loopDuration(), 0.01);
    // A note played in time with loop position p arrives `latency` frames after p was scheduled,
    // so capture runs `latency` late and is written `latency` earlier.
    const latency = this.latencyFrames();
    const startFrame = Math.round(this.recStart * this.ctx.sampleRate) + latency;
    this.od = {
      layer: new Float32Array(len),
      startFrame,
      endFrame: startFrame + len,
      latency,
      firstPos: null,
      lastPos: 0,
      gain: this.layerGain(),
      previewed: false,
      ended: false,
    };
    this.setCapture("overdub");
  }

  async stopOverdub(): Promise<void> {
    const od = this.od;
    if (!od) return;
    this.stopTicks(); // stopping during the count-in cancels it: nothing is written, no layer is added
    this.unduck();
    // Cancelled during the count-in: bring the loop back now, from the top.
    if (this.ctx.currentTime < this.recStart) this.startSources(this.layers, this.ctx.currentTime + START_LEAD_SEC);
    od.endFrame = Math.min(od.endFrame, Math.round(this.ctx.currentTime * this.ctx.sampleRate) + od.latency);
    await wait(FLUSH_MS);
    this.setCapture("none");
    this.od = null;
    if (od.firstPos === null) {
      od.gain.disconnect();
      return;
    }

    const n = Math.round(FADE_SEC * this.ctx.sampleRate);
    fadeAt(od.layer, od.firstPos, n, "in");
    fadeAt(od.layer, od.lastPos, n, "out");
    this.layers.push({ buffer: this.toBuffer(od.layer), gain: od.gain });
    // Replaces the preview (if any) with the complete, faded layer. Same content, so the swap is inaudible.
    if (this.isPlaying()) this.startSources(this.layers, this.loopStart);
  }

  /** Seconds until the running overdub ends by itself. */
  overdubRemaining(): number {
    if (!this.od) return 0;
    return Math.max(0, (this.od.endFrame - this.od.latency) / this.ctx.sampleRate - this.ctx.currentTime);
  }

  /**
   * Just before an overdub auto-ends, schedule the layer recorded so far to start playing exactly
   * at the loop point, so its first notes are heard on the very next pass. Only the last
   * PREVIEW_SEC is missing, and that part plays a whole loop later, after stopOverdub has swapped
   * in the complete layer.
   */
  private previewLayer(od: Overdub): void {
    if (od.firstPos === null) return;
    const copy = od.layer.slice();
    fadeAt(copy, od.firstPos, Math.round(FADE_SEC * this.ctx.sampleRate), "in");
    const loopPoint = (od.endFrame - od.latency) / this.ctx.sampleRate;
    this.startSources([...this.layers, { buffer: this.toBuffer(copy), gain: od.gain }], this.loopStart, loopPoint);
  }

  /** Every overdub write goes through here. Latency compensation will be applied in this one place. */
  private writeOverdub(od: Overdub, samples: Float32Array, frame: number): void {
    if (frame + samples.length <= od.startFrame || frame >= od.endFrame) return;
    if (frame < od.startFrame) {
      samples = samples.subarray(od.startFrame - frame);
      frame = od.startFrame;
    }
    if (frame + samples.length > od.endFrame) samples = samples.subarray(0, od.endFrame - frame);

    const pos = frame - Math.round(this.loopStart * this.ctx.sampleRate) - od.latency; // latency compensation
    od.firstPos ??= mod(pos, od.layer.length);
    writeWrapped(od.layer, samples, pos);
    od.lastPos = mod(pos + samples.length, od.layer.length);
  }

  // ---- transport ----

  /** Volume of each layer, 0..1, in recording order (layer 0 is the first loop). */
  layerVolumes(): number[] {
    return this.layers.map((l) => l.gain.gain.value);
  }

  setLayerVolume(index: number, volume: number): void {
    const layer = this.layers[index];
    // A short glide avoids zipper noise while dragging.
    layer?.gain.gain.setTargetAtTime(Math.min(1, Math.max(0, volume)), this.ctx.currentTime, 0.015);
  }

  layerCount(): number {
    return this.layers.length;
  }

  loopDuration(): number {
    return this.layers[0]?.buffer.duration ?? 0;
  }

  isPlaying(): boolean {
    return this.sources.length > 0;
  }

  /** Current loop position in seconds. */
  position(): number {
    const dur = this.loopDuration();
    if (!dur) return 0;
    if (!this.isPlaying()) return this.offset;
    // Before a scheduled start (e.g. during an overdub count-in) the loop sits at its top.
    return this.ctx.currentTime < this.loopStart ? 0 : mod(this.ctx.currentTime - this.loopStart, dur);
  }

  play(): void {
    this.startSources(this.layers, this.ctx.currentTime + START_LEAD_SEC - this.offset);
  }

  pause(): void {
    this.offset = this.position();
    this.stopSources();
  }

  stop(): void {
    this.offset = 0;
    this.stopSources();
  }

  undo(): void {
    if (this.layers.length < 2) return;
    this.layers.pop()?.gain.disconnect();
    if (this.isPlaying()) this.startSources(this.layers, this.loopStart);
  }

  clear(): void {
    this.unduck();
    this.cancelRecording();
    this.od = null;
    this.stopSources();
    this.layers.forEach((l) => l.gain.disconnect());
    this.layers = [];
    this.offset = 0;
  }

  // ---- internals ----

  /**
   * Starts one looping source per layer, all at the same scheduled time, aligned so that
   * loop position 0 falls on `loopStart`. Replaces any running sources at that same instant,
   * so layer changes are seamless.
   */
  private startSources(
    layers: Layer[],
    loopStart: number,
    when = this.ctx.currentTime + START_LEAD_SEC,
  ): void {
    // A time already in the past would start late but keep the old offset, knocking the loop out of alignment.
    when = Math.max(when, this.ctx.currentTime + 0.005);
    const offset = mod(when - loopStart, this.loopDuration());
    const old = this.sources;
    this.sources = layers.map(({ buffer, gain }) => {
      const s = this.ctx.createBufferSource();
      s.buffer = buffer;
      s.loop = true;
      s.connect(gain);
      s.start(when, offset);
      return s;
    });
    old.forEach((s) => s.stop(when));
    this.loopStart = loopStart;
  }

  private stopSources(): void {
    this.sources.forEach((s) => s.stop());
    this.sources = [];
  }

  private setCapture(mode: "none" | "master" | "overdub"): void {
    this.mode = mode;
    this.capture.port.postMessage(mode !== "none");
  }

  private onBlock({ frame, samples }: Block): void {
    if (this.mode === "overdub" && this.od) {
      const od = this.od;
      this.writeOverdub(od, samples, frame);
      const reached = frame + samples.length;
      if (!od.previewed && reached >= od.endFrame - od.latency - PREVIEW_SEC * this.ctx.sampleRate) {
        od.previewed = true;
        this.previewLayer(od);
      }
      if (!od.ended && reached >= od.endFrame) {
        od.ended = true;
        this.onOverdubEnd?.();
      }
    } else if (this.mode === "master") {
      const start = Math.round(this.recStart * this.ctx.sampleRate);
      if (frame + samples.length <= start) return; // still counting in
      this.masterBlocks.push(
        frame < start ? { frame: start, samples: samples.subarray(start - frame) } : { frame, samples },
      );
    }
  }

  private tick(when: number, last: boolean): OscillatorNode {
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.frequency.value = last ? 1320 : 880;
    gain.gain.setValueAtTime(0.15, when);
    gain.gain.exponentialRampToValueAtTime(0.001, when + 0.05);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(when);
    osc.stop(when + 0.06);
    return osc;
  }

  private layerGain(): GainNode {
    const gain = this.ctx.createGain();
    gain.connect(this.out);
    return gain;
  }

  private toBuffer(data: Float32Array<ArrayBuffer>): AudioBuffer {
    const buf = this.ctx.createBuffer(1, data.length, this.ctx.sampleRate);
    buf.copyToChannel(data, 0);
    return buf;
  }
}
