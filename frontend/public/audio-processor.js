/**
 * AudioWorklet processor — captures raw PCM from the microphone.
 *
 * Accumulates 128-sample blocks from the Web Audio engine until we have
 * 800 samples (50 ms at 16 kHz), then converts Float32 → Int16 and posts
 * the raw ArrayBuffer to the main thread for transmission over WebSocket.
 *
 * Running inside the AudioWorklet thread means mic capture is isolated from
 * UI jank — even if React re-renders heavily, audio is never dropped.
 */
class AudioProcessor extends AudioWorkletProcessor {
  constructor () {
    super()
    this._buf = []   // accumulated Float32Array slices
    this._len = 0    // total samples accumulated
    this._target = 800 // 50 ms at 16 kHz
  }

  process (inputs) {
    const channel = inputs[0]?.[0]
    if (!channel) return true

    // The engine reuses the buffer after process() returns — slice to own it.
    this._buf.push(channel.slice())
    this._len += channel.length

    while (this._len >= this._target) {
      // Build one flat Float32Array of exactly _target samples.
      const flat = new Float32Array(this._target)
      let offset = 0
      let remaining = this._target

      while (remaining > 0 && this._buf.length > 0) {
        const first = this._buf[0]
        const take = Math.min(first.length, remaining)
        flat.set(first.subarray(0, take), offset)
        offset += take
        remaining -= take

        if (take === first.length) {
          this._buf.shift()
          this._len -= first.length
        } else {
          this._buf[0] = first.subarray(take)
          this._len -= take
        }
      }

      // Float32 → Int16 little-endian (halves bandwidth vs Float32).
      const i16 = new Int16Array(this._target)
      for (let i = 0; i < this._target; i++) {
        const s = Math.max(-1, Math.min(1, flat[i]))
        i16[i] = s < 0 ? s * 0x8000 : s * 0x7fff
      }

      // Transfer ownership — zero-copy across thread boundary.
      this.port.postMessage(i16.buffer, [i16.buffer])
    }

    return true
  }
}

registerProcessor('audio-processor', AudioProcessor)
