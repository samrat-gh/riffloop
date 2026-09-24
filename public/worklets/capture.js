// Posts mono input blocks to the main thread, stamped with the audio clock frame.
// Only active while RiffLoop is recording or overdubbing.
class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.active = false;
    this.port.onmessage = (e) => {
      this.active = e.data;
    };
  }

  process(inputs) {
    const channels = inputs[0];
    if (!this.active || channels.length === 0) return true;

    // Average all channels: the guitar may be on any input of an interface.
    const n = channels[0].length;
    const mono = new Float32Array(n);
    for (const ch of channels) {
      for (let i = 0; i < n; i++) mono[i] += ch[i];
    }
    if (channels.length > 1) {
      for (let i = 0; i < n; i++) mono[i] /= channels.length;
    }

    this.port.postMessage({ frame: currentFrame, samples: mono }, [mono.buffer]);
    return true;
  }
}

registerProcessor("capture", CaptureProcessor);
