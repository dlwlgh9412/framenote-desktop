class MinuteFrameSystemAudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.chunks = []
    this.offset = 0
    this.queuedSamples = 0
    this.maxQueuedSamples = sampleRate * 2 * 2
    this.port.onmessage = ({ data }) => {
      const samples = data instanceof Float32Array ? data : new Float32Array(data)
      if (samples.length === 0 || samples.length % 2 !== 0) return
      this.chunks.push(samples)
      this.queuedSamples += samples.length
      while (this.queuedSamples > this.maxQueuedSamples && this.chunks.length > 1) {
        const removed = this.chunks.shift()
        this.queuedSamples -= removed.length - this.offset
        this.offset = 0
      }
    }
  }

  process(_inputs, outputs) {
    const output = outputs[0]
    const frames = output[0]?.length ?? 0
    for (let frame = 0; frame < frames; frame += 1) {
      let left = 0
      let right = 0
      const chunk = this.chunks[0]
      if (chunk) {
        left = chunk[this.offset] ?? 0
        right = chunk[this.offset + 1] ?? left
        this.offset += 2
        this.queuedSamples -= 2
        if (this.offset >= chunk.length) {
          this.chunks.shift()
          this.offset = 0
        }
      }
      if (output[0]) output[0][frame] = left
      if (output[1]) output[1][frame] = right
    }
    return true
  }
}

registerProcessor('minuteframe-system-audio', MinuteFrameSystemAudioProcessor)
