/* AudioWorklet: average-resample hardware audio to 16 kHz PCM, 50 ms frames. */
class OpsCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.frame = new Int16Array(800);
    this.index = 0;
    this.phase = 0;
    this.sum = 0;
    this.count = 0;
    this.energy = 0;
  }
  process(inputs) {
    const samples = inputs[0]?.[0];
    if (!samples) return true;
    for (const sample of samples) {
      this.sum += sample;
      this.count++;
      this.phase += 16000;
      if (this.phase >= sampleRate) {
        this.phase -= sampleRate;
        const value = Math.max(-1, Math.min(1, this.sum / this.count));
        this.sum = 0;
        this.count = 0;
        this.frame[this.index++] = Math.round(value * (value < 0 ? 32768 : 32767));
        this.energy += value * value;
        if (this.index === this.frame.length) {
          const buffer = new ArrayBuffer(1600);
          const view = new DataView(buffer);
          for (let i = 0; i < 800; i++) view.setInt16(i * 2, this.frame[i], true);
          this.port.postMessage({ pcm: buffer, level: Math.sqrt(this.energy / 800) }, [buffer]);
          this.index = 0;
          this.energy = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor("ops-capture", OpsCapture);
