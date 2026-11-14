/**
 * The microphone and the speaker for talking to Ops live: the microphone as
 * 16 kHz 16-bit PCM in 50 ms frames (an AudioWorklet, public/ops-capture.js),
 * and Ops's voice as 24 kHz PCM played in order. The same approach as Nia's in
 * Control Tower, which works on phones and desktops alike.
 */
export class LiveAudio {
  private context: AudioContext;
  private stream: MediaStream | null = null;
  private capture: AudioWorkletNode | null = null;
  private sources = new Set<AudioBufferSourceNode>();
  private nextPlay = 0;
  private closed = false;
  private speaking = false;
  muted = false;

  constructor(private readonly onSpeaking: (active: boolean) => void) {
    this.context = new AudioContext();
  }

  /** Starts the microphone; every 50 ms frame goes to `onFrame`. */
  async start(onFrame: (pcm: ArrayBuffer) => void): Promise<void> {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      throw new Error("Talking needs a secure connection (https). You can still type.");
    }
    await this.context.resume();
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
    } catch (error) {
      throw new Error(
        error instanceof DOMException && error.name === "NotAllowedError"
          ? "Microphone access was refused. Allow it in the browser's site settings and try again."
          : "Could not use the microphone.",
      );
    }
    if (this.closed) {
      for (const track of stream.getTracks()) track.stop();
      throw new Error("The conversation ended.");
    }
    this.stream = stream;
    await this.context.audioWorklet.addModule("/ops-capture.js");
    if (this.closed) throw new Error("The conversation ended.");
    this.capture = new AudioWorkletNode(this.context, "ops-capture");
    const source = this.context.createMediaStreamSource(stream);
    const silent = this.context.createGain();
    silent.gain.value = 0;
    this.capture.port.onmessage = ({ data }: MessageEvent<{ pcm: ArrayBuffer }>) => {
      if (!this.closed && !this.muted) onFrame(data.pcm);
    };
    source.connect(this.capture);
    this.capture.connect(silent);
    silent.connect(this.context.destination);
  }

  /** Plays a piece of Ops's voice (24 kHz 16-bit mono PCM) after what is already queued. */
  play(pcm: ArrayBuffer): void {
    if (this.closed || !pcm.byteLength || pcm.byteLength % 2) return;
    if (this.context.state !== "running") void this.context.resume().catch(() => undefined);
    const view = new DataView(pcm);
    const count = pcm.byteLength / 2;
    const buffer = this.context.createBuffer(1, count, 24000);
    const values = buffer.getChannelData(0);
    for (let index = 0; index < count; index += 1) {
      values[index] = view.getInt16(index * 2, true) / 32768;
    }
    const node = this.context.createBufferSource();
    node.buffer = buffer;
    node.connect(this.context.destination);
    this.sources.add(node);
    this.nextPlay = Math.max(this.nextPlay, this.context.currentTime + 0.025);
    node.onended = () => {
      node.disconnect();
      this.sources.delete(node);
      this.setSpeaking(this.sources.size > 0);
    };
    node.start(this.nextPlay);
    this.nextPlay += buffer.duration;
    this.setSpeaking(true);
  }

  /** The person spoke over Ops: what was still queued is dropped. */
  stopOutput(): void {
    for (const node of this.sources) {
      node.onended = null;
      node.stop();
      node.disconnect();
    }
    this.sources.clear();
    this.nextPlay = 0;
    this.setSpeaking(false);
  }

  mute(value: boolean): void {
    this.muted = value;
    for (const track of this.stream?.getAudioTracks() ?? []) track.enabled = !value;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.stopOutput();
    this.capture?.disconnect();
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    void this.context.close().catch(() => undefined);
  }

  private setSpeaking(active: boolean): void {
    if (active !== this.speaking) {
      this.speaking = active;
      this.onSpeaking(active);
    }
  }
}
