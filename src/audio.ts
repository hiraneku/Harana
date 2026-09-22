// Mesin audio Harana.
// - Piano: sampel Salamander Grand asli (rekaman grand piano), pitch-shift per nada.
// - Instrumen lain: disintesis via Web Audio API.

export type InstrumentId = 'harpa' | 'piano' | 'seruling' | 'orgel'

export interface Instrument {
  id: InstrumentId
  label: string
  icon: string
}

export const INSTRUMENTS: Instrument[] = [
  { id: 'piano', label: 'Piano', icon: '🎹' },
  { id: 'harpa', label: 'Harpa', icon: '🪕' },
  { id: 'seruling', label: 'Seruling', icon: '🎵' },
  { id: 'orgel', label: 'Orgel', icon: '🕯️' },
]

/** Sampel Salamander Grand — tersedia tiap 3 semit (names → nomor MIDI) */
const SALAMANDER: Record<string, number> = {
  A3: 57, C4: 60, Ds4: 63, Fs4: 66,
  A4: 69, C5: 72, Ds5: 75, Fs5: 78,
  A5: 81, C6: 84, Ds6: 87, Fs6: 90,
  A6: 93, C7: 96,
}

class AudioEngine {
  private ctx: AudioContext | null = null
  private bus: GainNode | null = null // semua suara lewat sini → master
  private master: GainNode | null = null
  private convolver: ConvolverNode | null = null
  private wet: GainNode | null = null
  private pianoBuffers = new Map<number, AudioBuffer>()
  private pianoLoading: Promise<void> | null = null
  private pianoError = false
  private noiseBuf: AudioBuffer | null = null
  /** Suara yang sedang berbunyi — dibatasi supaya main cepat tidak memberati CPU */
  private active: Array<{ g: GainNode; end: number }> = []
  private readonly MAX_VOICES = 20
  volume = 0.8
  /** Intensitas gaung gua (0 = kering, 1 = penuh) */
  reverb = 0.3
  pianoReady = false
  onPianoReady: (() => void) | null = null

  private ensureContext(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext()
      this.master = this.ctx.createGain()
      this.master.gain.value = this.volume
      this.master.connect(this.ctx.destination)

      this.bus = this.ctx.createGain()
      this.bus.connect(this.master)

      // Reverb "dalam gua": ConvolverNode dengan impulse response buatan —
      // noise stereo yang meluruh eksponensial (seperti pantulan dinding gua),
      // dimuffle lowpass biar ekornya gelap & dengung.
      const dur = 3.2
      const rate = this.ctx.sampleRate
      const ir = this.ctx.createBuffer(2, rate * dur, rate)
      for (let ch = 0; ch < 2; ch++) {
        const data = ir.getChannelData(ch)
        for (let i = 0; i < data.length; i++) {
          const p = i / data.length
          data[i] = (Math.random() * 2 - 1) * Math.pow(1 - p, 2.2)
        }
      }
      this.convolver = this.ctx.createConvolver()
      this.convolver.buffer = ir

      const reverbFilter = this.ctx.createBiquadFilter()
      reverbFilter.type = 'lowpass'
      reverbFilter.frequency.value = 1800

      this.wet = this.ctx.createGain()
      this.wet.gain.value = this.reverb

      this.bus.connect(this.convolver)
      this.convolver.connect(reverbFilter)
      reverbFilter.connect(this.wet)
      this.wet.connect(this.master)
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume()
    }
    return this.ctx
  }

  setVolume(v: number) {
    this.volume = v
    if (this.ctx && this.master) {
      this.master.gain.linearRampToValueAtTime(v, this.ctx.currentTime + 0.05)
    }
  }

  /** Atur intensitas gaung gua (0–1) */
  setReverb(v: number) {
    this.reverb = v
    if (this.ctx && this.wet) {
      this.wet.gain.linearRampToValueAtTime(v, this.ctx.currentTime + 0.1)
    }
  }

  /** Buffer noise hammer — dibuat sekali, dipakai ulang di semua klik */
  private getNoise(ctx: AudioContext): AudioBuffer {
    if (!this.noiseBuf) {
      const dur = 0.04
      this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate)
      const data = this.noiseBuf.getChannelData(0)
      for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length)
    }
    return this.noiseBuf
  }

  /** Daftarkan suara aktif; batasi jumlah dengan fade-out suara terlama */
  private registerVoice(g: GainNode, endTime: number): void {
    if (!this.ctx) return
    const t = this.ctx.currentTime
    this.active = this.active.filter((v) => v.end > t)
    if (this.active.length >= this.MAX_VOICES) {
      const oldest = this.active.shift()!
      try {
        oldest.g.gain.setTargetAtTime(0, t, 0.012)
      } catch { /* node mungkin sudah selesai */ }
    }
    this.active.push({ g, end: endTime })
  }

  /** Unduh & decode semua sampel piano di background */
  loadPiano(): void {
    if (this.pianoReady || this.pianoLoading || this.pianoError) return
    const base = (import.meta.env?.BASE_URL ?? '/') + 'piano/'
    this.pianoLoading = (async () => {
      const ctx = this.ensureContext()
      await Promise.all(
        Object.entries(SALAMANDER).map(async ([name, midi]) => {
          const res = await fetch(`${base}${name}.mp3`)
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          const arr = await res.arrayBuffer()
          this.pianoBuffers.set(midi, await ctx.decodeAudioData(arr))
        }),
      )
      this.pianoReady = true
      this.onPianoReady?.()
    })().catch((e) => {
      console.warn('Gagal memuat sampel piano, fallback ke sintesis:', e)
      this.pianoError = true
      this.pianoLoading = null
    })
  }

  /** Cari MIDI sampel terdekat untuk nada target (jarak ≤ 2 semit) */
  private nearestSample(targetMidi: number): number {
    let best = 60
    let bestDist = Infinity
    for (const m of this.pianoBuffers.keys()) {
      const d = Math.abs(m - targetMidi)
      if (d < bestDist || (d === bestDist && m < best)) {
        bestDist = d
        best = m
      }
    }
    return best
  }

  private playPianoSample(semitoneOffset: number): void {
    const ctx = this.ensureContext()
    const targetMidi = 60 + semitoneOffset // C4 = 60
    const sampleMidi = this.nearestSample(targetMidi)
    const buf = this.pianoBuffers.get(sampleMidi)!
    const t = ctx.currentTime

    const src = ctx.createBufferSource()
    src.buffer = buf
    // Pitch shift: geser sampling rate (≤ ±2 semit → masih natural)
    src.playbackRate.value = Math.pow(2, (targetMidi - sampleMidi) / 12)

    const out = ctx.createGain()
    out.gain.setValueAtTime(0, t)
    out.gain.linearRampToValueAtTime(1.0, t + 0.004)
    // Fade lembut di ekor buffer supaya tidak "klik"
    out.gain.setTargetAtTime(0, t + buf.duration - 0.06, 0.03)
    src.connect(out)
    out.connect(this.bus!)
    src.start(t)
    this.registerVoice(out, t + buf.duration)
  }

  /** Mainkan satu nada (0–14) dengan offset semitone dari C4 */
  play(_keyIndex: number, semitoneOffset: number, instrument: InstrumentId): void {
    if (instrument === 'piano') {
      if (this.pianoReady) {
        this.playPianoSample(semitoneOffset)
        return
      }
      // Belum termuat → mulai unduh & fallback sintesis
      this.loadPiano()
    }
    this.playSynth(semitoneOffset, instrument)
  }

  private playSynth(semitoneOffset: number, instrument: InstrumentId): void {
    const ctx = this.ensureContext()
    const freq = 261.63 * Math.pow(2, semitoneOffset / 12)
    const t = ctx.currentTime
    let endDur = 2.6

    const out = ctx.createGain()
    out.gain.value = 0
    out.connect(this.bus!)

    switch (instrument) {
      case 'harpa': {
        const o1 = ctx.createOscillator()
        o1.type = 'triangle'
        o1.frequency.value = freq
        const o2 = ctx.createOscillator()
        o2.type = 'sine'
        o2.frequency.value = freq * 2
        const g2 = ctx.createGain()
        g2.gain.value = 0.25
        o1.connect(out)
        o2.connect(g2)
        g2.connect(out)
        out.gain.setValueAtTime(0, t)
        out.gain.linearRampToValueAtTime(0.5, t + 0.008)
        out.gain.exponentialRampToValueAtTime(0.0001, t + 2.4)
        o1.start(t); o2.start(t)
        o1.stop(t + 2.5); o2.stop(t + 2.5)
        endDur = 2.5
        break
      }
      case 'piano': {
        // Fallback sintesis jika sampel gagal dimuat
        const B = 0.0006
        const bus = ctx.createGain()
        const filter = ctx.createBiquadFilter()
        filter.type = 'lowpass'
        filter.Q.value = 0.7
        filter.frequency.setValueAtTime(freq * 14, t)
        filter.frequency.exponentialRampToValueAtTime(Math.max(freq * 1.5, 700), t + 1.6)
        bus.connect(filter)
        filter.connect(out)
        const partialGains = [0.9, 0.55, 0.3, 0.18, 0.1, 0.06, 0.035]
        partialGains.forEach((amp, i) => {
          const n = i + 1
          const o = ctx.createOscillator()
          o.type = 'sine'
          o.frequency.value = freq * n * Math.sqrt(1 + B * n * n)
          const g = ctx.createGain()
          const decay = 2.2 / (1 + n * 0.55)
          g.gain.setValueAtTime(amp, t)
          g.gain.exponentialRampToValueAtTime(0.0001, t + decay)
          o.connect(g)
          g.connect(bus)
          o.start(t)
          o.stop(t + decay + 0.15)
        })
        const noise = ctx.createBufferSource()
        noise.buffer = this.getNoise(ctx)
        const nf = ctx.createBiquadFilter()
        nf.type = 'bandpass'
        nf.frequency.value = Math.min(freq * 6, 6000)
        const ng = ctx.createGain()
        ng.gain.setValueAtTime(0.28, t)
        ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.04)
        noise.connect(nf)
        nf.connect(ng)
        ng.connect(bus)
        noise.start(t)
        out.gain.setValueAtTime(0, t)
        out.gain.linearRampToValueAtTime(0.85, t + 0.004)
        out.gain.exponentialRampToValueAtTime(0.22, t + 0.35)
        out.gain.exponentialRampToValueAtTime(0.0001, t + 3.2)
        endDur = 3.2
        break
      }
      case 'seruling': {
        const o = ctx.createOscillator()
        o.type = 'sine'
        o.frequency.value = freq
        const vibrato = ctx.createOscillator()
        vibrato.type = 'sine'
        vibrato.frequency.value = 5.2
        const vibGain = ctx.createGain()
        vibGain.gain.value = freq * 0.008
        vibrato.connect(vibGain)
        vibGain.connect(o.frequency)
        o.connect(out)
        out.gain.setValueAtTime(0, t)
        out.gain.linearRampToValueAtTime(0.38, t + 0.09)
        out.gain.setValueAtTime(0.38, t + 1.2)
        out.gain.exponentialRampToValueAtTime(0.0001, t + 2.6)
        o.start(t); vibrato.start(t)
        o.stop(t + 2.7); vibrato.stop(t + 2.7)
        endDur = 2.7
        break
      }
      case 'orgel': {
        const os = [1, 2, 4].map((mult) => {
          const o = ctx.createOscillator()
          o.type = 'sawtooth'
          o.frequency.value = freq * mult
          o.detune.value = (mult - 1) * 3
          return o
        })
        const filter = ctx.createBiquadFilter()
        filter.type = 'lowpass'
        filter.frequency.value = 1400
        filter.Q.value = 1.2
        for (const o of os) o.connect(filter)
        filter.connect(out)
        out.gain.setValueAtTime(0, t)
        out.gain.linearRampToValueAtTime(0.16, t + 0.15)
        out.gain.setValueAtTime(0.16, t + 2.0)
        out.gain.exponentialRampToValueAtTime(0.0001, t + 3.2)
        os.forEach((o) => { o.start(t); o.stop(t + 3.3) })
        endDur = 3.3
        break
      }
    }
    this.registerVoice(out, t + endDur)
  }
}

export const audio = new AudioEngine()
