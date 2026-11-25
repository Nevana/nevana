// Synthetisierte Soundeffekte (keine Audiodateien nötig).
let ac = null, master = null, noiseBuf = null;
export let muted = false;

export function initAudio() {
  if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
  try {
    ac = new (window.AudioContext || window.webkitAudioContext)();
    master = ac.createGain(); master.gain.value = 0.35; master.connect(ac.destination);
    noiseBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  } catch { ac = null; }
}

export function setMuted(m) { muted = m; }

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
