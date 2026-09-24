import { fadeAt, fadeEdges, writeWrapped } from "./buffer";

const MIN_LOOP_SEC = 0.5;
const FADE_SEC = 0.005;
const START_LEAD_SEC = 0.03; // schedule playback slightly ahead so all layers start together
const FLUSH_MS = 60; // wait for in-flight worklet blocks after a stop press
const OUTPUT_GAIN = 0.8; // headroom for summed layers

interface Block {
  frame: number;
  samples: Float32Array;
}

interface Overdub {
  layer: Float32Array<ArrayBuffer>;
  startFrame: number;
  endFrame: number;
  firstPos: number | null;
  lastPos: number;
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

  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private readonly meterData: Float32Array<ArrayBuffer>;

  private layers: AudioBuffer[] = [];
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

  /** Must be called from a user gesture (autoplay rules). */
  static async create(deviceId?: string): Promise<LoopEngine> {
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
        echoCancellation: false,
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
    const t0 = this.ctx.currentTime + (countIn > 0 ? 0.05 : 0);
    for (let i = 0; i < countIn; i++) this.ticks.push(this.tick(t0 + i, i === countIn - 1));
    this.recStart = t0 + countIn;
    this.masterBlocks = [];
    this.setCapture("master");
  }

  countdownRemaining(): number {
    return Math.max(0, this.recStart - this.ctx.currentTime);
  }

  recordingElapsed(): number {
    return Math.max(0, this.ctx.currentTime - this.recStart);
  }

  cancelRecording(): void {
    this.ticks.forEach((t) => t.stop());
    this.ticks = [];
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

    this.layers = [this.toBuffer(data)];
    // Loop position 0 is the moment Record was pressed to stop, like a pedal.
    this.startSources(stopTime);
    return true;
  }

  // ---- overdub ----

  startOverdub(): void {
    const len = this.layers[0].length;
    this.od = {
      layer: new Float32Array(len),
      startFrame: Math.round(this.ctx.currentTime * this.ctx.sampleRate),
      endFrame: Infinity,
      firstPos: null,
      lastPos: 0,
    };
    this.setCapture("overdub");
  }

  async stopOverdub(): Promise<void> {
    const od = this.od;
    if (!od) return;
    od.endFrame = Math.round(this.ctx.currentTime * this.ctx.sampleRate);
    await wait(FLUSH_MS);
    this.setCapture("none");
    this.od = null;
    if (od.firstPos === null) return;

    const n = Math.round(FADE_SEC * this.ctx.sampleRate);
    fadeAt(od.layer, od.firstPos, n, "in");
    fadeAt(od.layer, od.lastPos, n, "out");
    this.layers.push(this.toBuffer(od.layer));
    // ponytail: the new layer is heard only after the overdub stops; live-updating the buffer is the upgrade for hearing earlier passes while overdubbing.
    if (this.isPlaying()) this.startSources(this.loopStart);
  }

  /** Every overdub write goes through here. Latency compensation will be applied in this one place. */
  private writeOverdub(od: Overdub, samples: Float32Array, frame: number): void {
    if (frame + samples.length <= od.startFrame || frame >= od.endFrame) return;
    if (frame < od.startFrame) {
      samples = samples.subarray(od.startFrame - frame);
      frame = od.startFrame;
    }
    if (frame + samples.length > od.endFrame) samples = samples.subarray(0, od.endFrame - frame);

    const pos = frame - Math.round(this.loopStart * this.ctx.sampleRate);
    od.firstPos ??= mod(pos, od.layer.length);
    writeWrapped(od.layer, samples, pos);
    od.lastPos = mod(pos + samples.length, od.layer.length);
  }

  // ---- transport ----

  layerCount(): number {
    return this.layers.length;
  }

  loopDuration(): number {
    return this.layers[0]?.duration ?? 0;
  }

  isPlaying(): boolean {
    return this.sources.length > 0;
  }

  /** Current loop position in seconds. */
  position(): number {
    const dur = this.loopDuration();
    if (!dur) return 0;
    return this.isPlaying() ? mod(this.ctx.currentTime - this.loopStart, dur) : this.offset;
  }

  play(): void {
    this.startSources(this.ctx.currentTime + START_LEAD_SEC - this.offset);
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
    this.layers.pop();
    if (this.isPlaying()) this.startSources(this.loopStart);
  }

  clear(): void {
    this.cancelRecording();
    this.od = null;
    this.stopSources();
    this.layers = [];
    this.offset = 0;
  }

  // ---- internals ----

  /**
   * Starts one looping source per layer, all at the same scheduled time, aligned so that
   * loop position 0 falls on `loopStart`. Replaces any running sources at that same instant,
   * so layer changes are seamless.
   */
  private startSources(loopStart: number): void {
    const when = this.ctx.currentTime + START_LEAD_SEC;
    const offset = mod(when - loopStart, this.loopDuration());
    const old = this.sources;
    this.sources = this.layers.map((buffer) => {
      const s = this.ctx.createBufferSource();
      s.buffer = buffer;
      s.loop = true;
      s.connect(this.out);
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
      this.writeOverdub(this.od, samples, frame);
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

  private toBuffer(data: Float32Array<ArrayBuffer>): AudioBuffer {
    const buf = this.ctx.createBuffer(1, data.length, this.ctx.sampleRate);
    buf.copyToChannel(data, 0);
    return buf;
  }
}
