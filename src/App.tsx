import { useCallback, useEffect, useState, memo } from 'react'
import { audio, INSTRUMENTS, type InstrumentId } from './audio'

/** Offset semitone dari nada dasar — skala mayor 15 kunci seperti di Sky */
const SCALE_OFFSETS = [0, 2, 4, 5, 7, 9, 11, 12, 14, 16, 17, 19, 21, 23, 24]

/** Nomor pitch gaya Sky: 1–7 per oktaf */
const SKY_NUMBERS = [1, 2, 3, 4, 5, 6, 7, 1, 2, 3, 4, 5, 6, 7, 1]

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

/** Pemetaan keyboard fisik: baris atas QWERT, tengah ASDFG, bawah ZXCVB */
const KEYBOARD_ROWS = [
  ['Q', 'W', 'E', 'R', 'T'],
  ['A', 'S', 'D', 'F', 'G'],
  ['Z', 'X', 'C', 'V', 'B'],
]

/** Indeks tampilan grid — nada rendah di kiri atas, naik sampai kanan bawah */
function displayIndex(col: number, row: number): number {
  // row 0 (atas) → kunci 0–4 terendah, row 2 (bawah) → kunci 10–14 tertinggi
  return row * 5 + col
}

interface SkyKeyProps {
  keyIndex: number
  number: number
  octave: number
  kbKey: string
  isPressed: boolean
  onPress: (keyIndex: number) => void
}

/** Tombol tunggal — di-memo supaya re-render sebatas tombol yang berubah */
const SkyKey = memo(function SkyKey({ keyIndex, number, octave, kbKey, isPressed, onPress }: SkyKeyProps) {
  return (
    <button
      className={`sky-key ${isPressed ? 'sky-key-pressed' : ''} oct-${octave}`}
      onPointerDown={(e) => {
        e.preventDefault()
        onPress(keyIndex)
      }}
      aria-label={`Kunci ${number} oktaf ${octave}`}
    >
      <span className="sky-key-glow" />
      <span className="sky-key-number">
        {number}
        {octave > 0 && <span className="sky-key-dots">{octave === 1 ? '•' : ':'}</span>}
      </span>
      <span className="sky-key-kb">{kbKey}</span>
    </button>
  )
})

export default function App() {
  const [instrument, setInstrument] = useState<InstrumentId>('piano')
  const [pianoReady, setPianoReady] = useState(false)
  const [baseKey, setBaseKey] = useState(0) // 0 = C
  const [volume, setVolume] = useState(0.8)
  const [reverb, setReverb] = useState(0.3)
  const [pressed, setPressed] = useState<Set<number>>(new Set())

  const playKey = useCallback(
    (keyIndex: number) => {
      audio.play(keyIndex, baseKey + SCALE_OFFSETS[keyIndex], instrument)
      setPressed((prev) => new Set(prev).add(keyIndex))
      window.setTimeout(() => {
        setPressed((prev) => {
          const next = new Set(prev)
          next.delete(keyIndex)
          return next
        })
      }, 260)
    },
    [baseKey, instrument],
  )

  // Muat sampel piano di background begitu aplikasi dibuka
  useEffect(() => {
    audio.onPianoReady = () => setPianoReady(true)
    audio.loadPiano()
    return () => {
      audio.onPianoReady = null
    }
  }, [])
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return
      const k = e.key.toUpperCase()
      for (let row = 0; row < 3; row++) {
        const col = KEYBOARD_ROWS[row].indexOf(k)
        if (col !== -1) {
          playKey(displayIndex(col, row))
          return
        }
      }
    }
    window.addEventListener('keydown', down)
    return () => window.removeEventListener('keydown', down)
  }, [playKey])

  const octaveOf = (keyIndex: number) => Math.floor(keyIndex / 7)

  return (
    <div className="app">
      <div className="stars" aria-hidden="true" />
      <div className="stars stars-2" aria-hidden="true" />
      <div className="cloud cloud-1" aria-hidden="true" />
      <div className="cloud cloud-2" aria-hidden="true" />

      <header className="header">
        <h1 className="logo">
          Harana <span className="logo-sub">· Sky Piano</span>
        </h1>
        <p className="tagline">Mainkan melodi dari atas awan — klik, sentuh, atau pakai keyboard</p>
      </header>

      {/* Panel instrumen */}
      <section className="panel">
        <div className="panel-group">
          <span className="panel-label">Instrumen</span>
          <div className="chips">
            {INSTRUMENTS.map((inst) => (
              <button
                key={inst.id}
                className={`chip ${instrument === inst.id ? 'chip-active' : ''}`}
                onClick={() => setInstrument(inst.id)}
              >
                <span className="chip-icon">{inst.icon}</span>
                {inst.label}
              </button>
            ))}
          </div>
          {instrument === 'piano' && !pianoReady && (
            <span className="loading-hint">⏳ mengunduh sampel grand piano…</span>
          )}
        </div>

        <div className="panel-group">
          <span className="panel-label">Nada Dasar</span>
          <div className="chips chips-keys">
            {NOTE_NAMES.map((name, i) => (
              <button
                key={name}
                className={`chip chip-key ${baseKey === i ? 'chip-active' : ''}`}
                onClick={() => setBaseKey(i)}
              >
                {name}
              </button>
            ))}
          </div>
        </div>

        <div className="panel-group">
          <span className="panel-label">Volume</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            className="volume"
            onChange={(e) => {
              const v = Number(e.target.value)
              setVolume(v)
              audio.setVolume(v)
            }}
          />
          <span className="volume-value">{Math.round(volume * 100)}%</span>
        </div>

        <div className="panel-group">
          <span className="panel-label">Gaung Gua</span>
          <input
            type="range"
            min={0}
            max={0.9}
            step={0.01}
            value={reverb}
            className="volume"
            onChange={(e) => {
              const v = Number(e.target.value)
              setReverb(v)
              audio.setReverb(v)
            }}
          />
          <span className="volume-value">{Math.round((reverb / 0.9) * 100)}%</span>
        </div>
      </section>

      {/* Grid 15 kunci Sky */}
      <main className="sky-grid" role="application" aria-label="Sky piano 15 kunci">
        {KEYBOARD_ROWS.map((row, ri) => (
          <div className="sky-row" key={ri}>
            {row.map((kbKey, ci) => {
              const keyIndex = displayIndex(ci, ri)
              return (
                <SkyKey
                  key={kbKey}
                  keyIndex={keyIndex}
                  number={SKY_NUMBERS[keyIndex]}
                  octave={octaveOf(keyIndex)}
                  kbKey={kbKey}
                  isPressed={pressed.has(keyIndex)}
                  onPress={playKey}
                />
              )
            })}
          </div>
        ))}
      </main>

      <footer className="footer">
        <p>
          ⌨️ Q W E R T · A S D F G · Z X C V B — nada terendah di kiri atas, tertinggi di kanan bawah
        </p>
        <p className="credit">Suara piano dari sampel Salamander Grand Piano (Alexander Holm)</p>
      </footer>
    </div>
  )
}
