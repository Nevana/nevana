// Synthetisierte Soundeffekte (keine Audiodateien nötig).
let ac = null, master = null, noiseBuf = null;
export let muted = false;
let sfxVol = 0.35;          // Effekt-Lautstärke (0..1 → Master-Gain)
let musicOn = true, musicVol = 0.4, musicWanted = false;
let musicBus = null, musicTimer = null;

export function initAudio() {
  if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
  try {
    ac = new (window.AudioContext || window.webkitAudioContext)();
    master = ac.createGain(); master.gain.value = sfxVol; master.connect(ac.destination);
    noiseBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    buildMusicBus();
    applyMusic();
  } catch { ac = null; }
}

export function setMuted(m) { muted = m; }
export function setSfxVolume(v) { sfxVol = v; if (master) master.gain.value = v; }

// ---------------- Hintergrundmusik ----------------
// Ruhige, generative Ambient-Musik: weiche Akkord-Flächen (Am–F–C–G) und vereinzelte
// Pentatonik-Töne mit sanftem Echo. Läuft endlos, ohne Audiodateien, ohne harte Loops.
const CHORDS = [
  [57, 60, 64], [53, 57, 60], [48, 55, 64], [55, 59, 62],   // Am, F, C, G (MIDI)
];
const SCALE = [69, 72, 74, 76, 79, 81, 84];                  // A-Moll-Pentatonik (+ D)
const CHORD_LEN = 8;                                         // Sekunden pro Akkord
let nextChord = 0, chordIdx = 0, nextNote = 0;
const mtof = n => 440 * Math.pow(2, (n - 69) / 12);

function buildMusicBus() {
  musicBus = ac.createGain(); musicBus.gain.value = 0; musicBus.connect(ac.destination);
  // Echo für die Einzeltöne
  const dly = ac.createDelay(1.5); dly.delayTime.value = 0.42;
  const fb = ac.createGain(); fb.gain.value = 0.38;
  const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1800;
  dly.connect(lp); lp.connect(fb); fb.connect(dly); lp.connect(musicBus);
  musicBus.echo = dly;
}

function padNote(midi, t, dur, vol) {
  const g = ac.createGain();
  const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 700;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + 2.5);
  g.gain.linearRampToValueAtTime(0, t + dur + 3);
  f.connect(g); g.connect(musicBus);
  for (const det of [-6, 6]) {
    const o = ac.createOscillator(); o.type = 'triangle';
    o.frequency.value = mtof(midi); o.detune.value = det;
    o.connect(f); o.start(t); o.stop(t + dur + 3.1);
  }
}

function pluck(midi, t, vol) {
  const o = ac.createOscillator(); o.type = 'sine'; o.frequency.value = mtof(midi);
  const g = ac.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.001, t + 2.2);
  o.connect(g); g.connect(musicBus); g.connect(musicBus.echo);
  o.start(t); o.stop(t + 2.3);
}

function scheduleMusic() {
  if (!ac || !musicBus || !musicOn || !musicWanted) return;
  const now = ac.currentTime;
  if (nextChord < now) { nextChord = now + 0.1; nextNote = nextChord + 1; }   // nach Pause neu aufsetzen
  while (nextChord < now + 2) {
    const c = CHORDS[chordIdx % CHORDS.length];
    for (const n of c) padNote(n, nextChord, CHORD_LEN, 0.16);
    padNote(c[0] - 12, nextChord, CHORD_LEN, 0.22);                           // Bass
    chordIdx++; nextChord += CHORD_LEN;
  }
  while (nextNote < now + 2) {
    if (Math.random() < 0.4) pluck(SCALE[Math.floor(Math.random() * SCALE.length)], nextNote, 0.07 + Math.random() * 0.04);
    nextNote += 0.75;
  }
}

function applyMusic() {
  if (!ac || !musicBus) return;
  const on = musicOn && musicWanted;
  const target = on ? musicVol * musicVol * 0.9 : 0;           // quadratisch: feinere Regelung bei leise
  musicBus.gain.cancelScheduledValues(ac.currentTime);
  musicBus.gain.setTargetAtTime(target, ac.currentTime, 0.4);   // weiches Ein-/Ausblenden
  if (on && !musicTimer) { nextChord = 0; musicTimer = setInterval(scheduleMusic, 400); scheduleMusic(); }
  if (!on && musicTimer) { clearInterval(musicTimer); musicTimer = null; }
}

export function setMusicWanted(w) { musicWanted = w; applyMusic(); }   // z. B. nur im Spiel
export function setMusicEnabled(b) { musicOn = b; applyMusic(); }
export function setMusicVolume(v) { musicVol = v; applyMusic(); }

function noise(dur, freq, gain, type = 'lowpass', q = 0.7) {
  const src = ac.createBufferSource(); src.buffer = noiseBuf;
  const f = ac.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = ac.createGain();
  const t = ac.currentTime;
  g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f); f.connect(g); g.connect(master);
  src.start(t, Math.random()); src.stop(t + dur);
  return f;
}

function tone(freq, dur, gain = 0.3, type = 'square', slide = 0, delay = 0) {
  const o = ac.createOscillator(); o.type = type;
  const g = ac.createGain();
  const t = ac.currentTime + delay;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
  g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(master); o.start(t); o.stop(t + dur);
}

export function play(name, arg) {
  if (!ac || muted) return;
  switch (name) {
    case 'boom': {
      const r = arg || 40;
      const f = noise(0.5 + r / 80, 300 + r * 6, 0.9);
      f.frequency.exponentialRampToValueAtTime(60, ac.currentTime + 0.6 + r / 80);
      tone(80, 0.4, 0.5, 'sine', -40);
      break;
    }
    case 'launch': noise(0.5, 1800, 0.25, 'bandpass', 1.5); tone(300, 0.3, 0.06, 'sawtooth', 400); break;
    case 'throw': tone(500, 0.12, 0.08, 'triangle', 300); break;
    case 'shot': noise(0.18, 2500, 0.6, 'highpass'); break;
    case 'bat': noise(0.12, 900, 0.7, 'bandpass', 2); tone(180, 0.15, 0.3, 'square', -100); break;
    case 'swoosh': noise(0.25, 1200, 0.2, 'bandpass', 3); break;
    case 'jump': tone(300, 0.12, 0.06, 'square', 300); break;
    case 'splash': noise(0.7, 900, 0.4, 'lowpass'); break;
    case 'beep': tone(1400, 0.08, 0.12, 'square'); tone(1400, 0.08, 0.12, 'square', 0, 0.15); break;
    case 'pickup': [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.12, 0.1, 'triangle', 0, i * 0.07)); break;
    case 'turn': tone(660, 0.12, 0.08, 'triangle'); tone(880, 0.18, 0.08, 'triangle', 0, 0.12); break;
    case 'tele': tone(200, 0.4, 0.1, 'sine', 1200); break;
    case 'plane': noise(2.5, 400, 0.15, 'lowpass'); break;
    case 'crate': tone(440, 0.1, 0.06, 'sine', 0); tone(550, 0.1, 0.06, 'sine', 0, 0.1); break;
    case 'win': [523, 659, 784, 659, 784, 1046].forEach((f, i) => tone(f, 0.2, 0.12, 'triangle', 0, i * 0.15)); break;
    case 'tick': tone(1000, 0.04, 0.05, 'square'); break;
  }
}
