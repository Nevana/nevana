// UI, Lobby und Spielsitzung (Host = simuliert, Gast = zeigt Snapshots an).
import { Engine, WEAPONS, WEAPON_BY_ID } from './engine.js';
import { Terrain, MAP_W, MAP_H, MAP_TYPES } from './terrain.js';
import { Renderer } from './render.js';
import { Net } from './net.js';
import { initAudio, play, setMuted, muted } from './audio.js';

const $ = id => document.getElementById(id);
const COLORS = ['#e53935', '#1e88e5', '#43a047', '#fdd835', '#8e24aa', '#00acc1'];
const MAX_TEAMS = 6;
const DIFF_LABEL = { easy: 'Leicht', medium: 'Mittel', hard: 'Schwer' };
const AI_NAMES = ['Tunnelbande', 'Die Wühler', 'Erdferkel-Gang', 'Schaufel-Mafia', 'Lehmköpfe', 'Kraterkommando', 'Maulwurf-Miliz', 'Buddel-Brigade'];
const MOLE_NAMES = ['Buddel', 'Krümel', 'Wühli', 'Schippe', 'Grabowski', 'Erdnuss', 'Kralle', 'Bohrer', 'Schnuffel', 'Klumpen',
  'Matsch', 'Knolle', 'Brösel', 'Hügel-Hans', 'Tunnel-Tina', 'Lehmi', 'Moppel', 'Wurzel', 'Kiesel', 'Stollen', 'Humus',
  'Rüssel', 'Nuss', 'Socke', 'Pfötchen', 'Graben-Gabi', 'Dreckspatz', 'Kuhle', 'Bröckchen', 'Schlammi', 'Rille', 'Kaktus'];
const SNAP_EVERY = 3;      // Ticks zwischen Snapshots (20 Hz)
const INTERP_DELAY = 110;  // ms Puffer für flüssige Darstellung bei Gästen

const S = {
  screen: 'menu',
  role: null,          // 'host' | 'guest'
  net: null,
  myId: 'local',
  code: null,
  lobby: null,         // { teams:[], settings:{} } (Host ist Eigentümer)
  engine: null,
  renderer: null,
  snaps: [],
  view: null,
  maxTeamHp: 1,
  hover: null,
};

// ---------------- Hilfen ----------------
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignorieren */ } },
};
function show(screen) {
  for (const s of ['menu', 'lobby', 'game']) $(s).classList.toggle('hidden', s !== screen);
  S.screen = screen;
}
let toastTimer = null;
function toast(text, ms = 2600) {
  const t = $('toast');
  t.textContent = text; t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), ms);
}
const uid = () => Math.random().toString(36).slice(2, 9);
const myName = () => ($('name').value.trim() || 'Spieler').slice(0, 18);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function freeColor(teams) { return COLORS.find(c => !teams.some(t => t.color === c)) || COLORS[0]; }
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

// ---------------- Menü ----------------
$('name').value = store.get('kk-name') || '';
$('name').addEventListener('change', () => store.set('kk-name', myName()));
const params = new URLSearchParams(location.search);
if (params.get('join')) {
  $('joinCode').value = params.get('join').toUpperCase();
  $('menuMsg').textContent = 'Du wurdest eingeladen! Name eingeben und auf „Beitreten“ klicken.';
}

$('btnCreate').onclick = async () => {
  initAudio();
  store.set('kk-name', myName());
  S.role = 'host';
  S.lobby = {
    teams: [{ id: uid(), name: myName(), color: COLORS[0], kind: 'human', owner: null }],
    settings: readSettings(),
  };
  S.code = null;
  $('menuMsg').textContent = 'Verbinde mit Server …';
  try {
    const net = new Net();
    await net.connect();
    S.net = net;
    setupHostNet(net);
    net.send({ t: 'create' });
  } catch (e) {
    S.net = null;
    S.myId = 'local';
    S.lobby.teams[0].owner = 'local';
    S.offlineReason = e.message;
    enterLobby();
  }
};

$('btnJoin').onclick = async () => {
  initAudio();
  store.set('kk-name', myName());
  const code = $('joinCode').value.trim().toUpperCase();
  if (code.length < 4) { $('menuMsg').textContent = 'Bitte einen gültigen Invite-Code eingeben.'; return; }
  $('menuMsg').textContent = 'Verbinde …';
  try {
    const net = new Net();
    await net.connect();
    S.net = net;
    S.role = 'guest';
    setupGuestNet(net);
    net.send({ t: 'join', code, name: myName() });
  } catch (e) {
    $('menuMsg').textContent = 'Keine Verbindung zum Server: ' + e.message;
  }
};
$('joinCode').addEventListener('keydown', e => { if (e.key === 'Enter') $('btnJoin').click(); });

function backToMenu(msg) {
  stopHostLoop();
  if (S.net) { S.net.handlers = {}; S.net.close(); }
  S.net = null; S.engine = null; S.role = null; S.lobby = null; S.view = null; S.snaps = [];
  $('overlay').classList.add('hidden');
  show('menu');
  $('menuMsg').textContent = msg || '';
  history.replaceState(null, '', location.pathname);
}

// ---------------- Lobby ----------------
function readSettings() {
  const f = $('settings');
  return {
    wormsPerTeam: +f.wormsPerTeam.value, hp: +f.hp.value, turnTime: +f.turnTime.value, map: f.map.value,
    suddenDeath: +f.suddenDeath.value, mines: f.mines.checked, crates: f.crates.checked,
  };
}
function writeSettings(s) {
  const f = $('settings');
  f.wormsPerTeam.value = s.wormsPerTeam; f.hp.value = s.hp; f.turnTime.value = s.turnTime; f.map.value = s.map;
  f.suddenDeath.value = s.suddenDeath; f.mines.checked = s.mines; f.crates.checked = s.crates;
}
$('settings').addEventListener('change', () => {
  if (S.role !== 'host') return;
  S.lobby.settings = readSettings();
  lobbyChanged();
});

function enterLobby() {
  show('lobby');
  $('overlay').classList.add('hidden');
  renderLobby();
}

function lobbyChanged() {
  renderLobby();
  if (S.role === 'host' && S.net) S.net.toAll({ t: 'lobby', lobby: S.lobby });
}

function renderLobby() {
  const L = S.lobby;
  if (!L) return;
  const host = S.role === 'host';
  const inv = $('invite');
  if (host && S.code) {
    const link = `${location.origin}${location.pathname}?join=${S.code}`;
    inv.innerHTML = `<div>Invite-Code</div><div class="code">${S.code}</div>
      <div><button id="copyCode">Code kopieren</button><button id="copyLink">Link kopieren</button></div>`;
    $('copyCode').onclick = () => copy(S.code);
    $('copyLink').onclick = () => copy(link);
  } else if (host) {
    inv.innerHTML = `<div class="offline">Offline-Modus – gegen KI und lokale Mitspieler.<br><small>Für Einladungen das Spiel über den Server starten (npm start).</small></div>`;
  } else {
    inv.innerHTML = `<div>Verbunden mit Lobby</div><div class="code">${esc(S.code || '')}</div>`;
  }
  $('teamCount').textContent = `(${L.teams.length}/${MAX_TEAMS})`;
  const ul = $('teamList');
  ul.innerHTML = '';
  L.teams.forEach(t => {
    const li = document.createElement('li');
    const mine = t.owner === S.myId && t.kind === 'human';
    if (mine) li.classList.add('me');
    const canEdit = host || mine;
    let tag;
    if (t.kind === 'ai') tag = `🤖 KI`;
    else if (t.owner === S.myId) tag = t.local ? '🎮 Lokal' : '⭐ Du';
    else if (t.owner === (S.hostId || S.myId) && t.local) tag = '🎮 Lokal (Host)';
    else tag = '🌐 Online';
    li.innerHTML = `<span class="dot" style="background:${t.color}"></span>
      <input maxlength="18" value="${esc(t.name)}" ${canEdit ? '' : 'readonly'}>
      <span class="tag">${tag}</span>`;
    const input = li.querySelector('input');
    input.addEventListener('change', () => {
      const name = input.value.trim().slice(0, 18) || t.name;
      if (host) { t.name = name; lobbyChanged(); }
      else S.net.toHost({ t: 'teamName', id: t.id, name });
    });
    li.querySelector('.dot').title = 'Farbe wechseln';
    li.querySelector('.dot').style.cursor = canEdit ? 'pointer' : 'default';
    li.querySelector('.dot').onclick = () => {
      if (!canEdit) return;
      if (host) { cycleColor(t); lobbyChanged(); } else S.net.toHost({ t: 'teamColor', id: t.id });
    };
    if (t.kind === 'ai') {
      const sel = document.createElement('select');
      sel.innerHTML = Object.entries(DIFF_LABEL).map(([k, v]) => `<option value="${k}" ${t.diff === k ? 'selected' : ''}>${v}</option>`).join('');
      sel.disabled = !host;
      sel.onchange = () => { t.diff = sel.value; lobbyChanged(); };
      li.appendChild(sel);
    }
    if (host && !(t.owner === S.myId && !t.local && t.kind === 'human')) {
      const b = document.createElement('button');
      b.textContent = '✕'; b.title = t.kind === 'human' && t.owner !== S.myId ? 'Spieler entfernen' : 'Entfernen';
      b.onclick = () => removeTeam(t);
      li.appendChild(b);
    }
    ul.appendChild(li);
  });
  $('hostAdd').classList.toggle('hidden', !host);
  $('btnAddAI').disabled = $('btnAddLocal').disabled = L.teams.length >= MAX_TEAMS;
  for (const el of $('settings').elements) el.disabled = !host;
  writeSettings(L.settings);
  $('btnStart').classList.toggle('hidden', !host);
  $('btnStart').disabled = L.teams.length < 2;
  $('lobbyMsg').textContent = host
    ? (L.teams.length < 2 ? 'Füge mindestens einen Gegner hinzu (KI oder lade jemanden ein).' : '')
    : 'Warte darauf, dass der Host das Spiel startet …';
}

function cycleColor(t) {
  const used = S.lobby.teams.filter(o => o !== t).map(o => o.color);
  let i = COLORS.indexOf(t.color);
  for (let k = 1; k <= COLORS.length; k++) {
    const c = COLORS[(i + k) % COLORS.length];
    if (!used.includes(c)) { t.color = c; return; }
  }
}

function copy(text) {
  (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject())
    .then(() => toast('Kopiert: ' + text))
    .catch(() => toast('Kopieren nicht möglich – bitte manuell markieren: ' + text, 6000));
}

$('btnAddAI').onclick = () => {
  const L = S.lobby;
  if (L.teams.length >= MAX_TEAMS) return;
  const used = L.teams.map(t => t.name);
  const name = AI_NAMES.find(n => !used.includes(n)) || 'KI-Team';
  L.teams.push({ id: uid(), name, color: freeColor(L.teams), kind: 'ai', diff: $('aiDiff').value, owner: null });
  lobbyChanged();
};
$('btnAddLocal').onclick = () => {
  const L = S.lobby;
  if (L.teams.length >= MAX_TEAMS) return;
  const n = L.teams.filter(t => t.local).length + 2;
  L.teams.push({ id: uid(), name: `Spieler ${n}`, color: freeColor(L.teams), kind: 'human', owner: S.myId, local: true });
  lobbyChanged();
};
function removeTeam(t) {
  const L = S.lobby;
  L.teams = L.teams.filter(o => o !== t);
  if (t.kind === 'human' && t.owner !== S.myId && S.net) S.net.send({ t: 'kick', id: t.owner });
  lobbyChanged();
}
$('btnLeave').onclick = () => backToMenu();
$('btnStart').onclick = () => startGame();

// ---------------- Netzwerk: Host ----------------
function setupHostNet(net) {
  net.on('created', m => {
    S.myId = m.id; S.code = m.code;
    S.lobby.teams[0].owner = m.id;
    enterLobby();
  });
  net.on('peer-join', m => {
    if (S.screen === 'game' && S.engine) {
      // Späteinsteiger: als Zuschauer ins laufende Spiel
      net.toPeer(m.id, startMessage());
      toast(`${m.name} schaut zu`);
      return;
    }
    const L = S.lobby;
    if (L.teams.length < MAX_TEAMS) {
      L.teams.push({ id: uid(), name: m.name, color: freeColor(L.teams), kind: 'human', owner: m.id });
      toast(`${m.name} ist beigetreten`);
    } else toast(`${m.name} ist als Zuschauer beigetreten (Lobby voll)`);
    lobbyChanged();
  });
  net.on('peer-leave', m => {
    if (S.screen === 'game' && S.engine) {
      S.engine.teams.forEach((t, i) => {
        if (t.owner === m.id && !t.ai) { S.engine.setAI(i, 'medium'); toast(`${t.name} hat das Spiel verlassen – die KI übernimmt.`, 4000); }
      });
      const lt = S.lobby.teams.find(t => t.owner === m.id);
      if (lt) { lt.kind = 'ai'; lt.diff = 'medium'; lt.owner = null; }
      return;
    }
    const before = S.lobby.teams.length;
    S.lobby.teams = S.lobby.teams.filter(t => t.owner !== m.id || t.kind !== 'human');
    if (S.lobby.teams.length !== before) { toast('Ein Spieler hat die Lobby verlassen'); lobbyChanged(); }
  });
  net.on('msg', m => onHostMessage(m.from, m.data || {}));
  net.on('error', m => toast(m.msg));
  net.on('close', () => {
    if (S.role !== 'host') return;
    S.net = null; S.code = null;
    toast('Verbindung zum Server verloren – das Spiel läuft lokal weiter.', 5000);
    if (S.screen === 'lobby') renderLobby();
  });
}

function onHostMessage(from, d) {
  const L = S.lobby;
  switch (d.t) {
    case 'hello':
      S.net.toPeer(from, { t: 'lobby', lobby: L });
      break;
    case 'teamName': {
      const t = L.teams.find(o => o.id === d.id && o.owner === from);
      if (t && S.screen === 'lobby') { t.name = String(d.name || '').slice(0, 18) || t.name; lobbyChanged(); }
      break;
    }
    case 'teamColor': {
      const t = L.teams.find(o => o.id === d.id && o.owner === from);
      if (t && S.screen === 'lobby') { cycleColor(t); lobbyChanged(); }
      break;
    }
    case 'in':
      if (S.engine) S.engine.input(from, String(d.k), !!d.d);
      break;
    case 'act':
      if (S.engine && d.a) S.engine.action(from, d.a);
      break;
  }
}

// ---------------- Netzwerk: Gast ----------------
function setupGuestNet(net) {
  net.on('joined', m => {
    S.myId = m.id; S.code = m.code; S.hostId = m.host;
    S.lobby = { teams: [], settings: readSettings() };
    $('menuMsg').textContent = '';
    enterLobby();
    net.toHost({ t: 'hello' });
  });
  net.on('error', m => { $('menuMsg').textContent = m.msg; net.close(); S.net = null; });
  net.on('kicked', () => backToMenu('Du wurdest vom Host entfernt.'));
  net.on('host-left', () => backToMenu('Der Host hat die Lobby geschlossen.'));
  net.on('close', () => { if (S.role === 'guest') backToMenu('Verbindung zum Server verloren.'); });
  net.on('msg', m => {
    const d = m.data || {};
    switch (d.t) {
      case 'lobby':
        S.lobby = d.lobby;
        if (S.screen === 'lobby') renderLobby();
        break;
      case 'start':
        guestStart(d);
        break;
      case 'snap':
        S.snaps.push({ time: performance.now(), view: d.v, ev: d.ev || [], applied: false });
        if (S.snaps.length > 60) S.snaps.splice(0, S.snaps.length - 60);
        break;
      case 'toLobby':
        S.engine = null; S.view = null; S.snaps = [];
        enterLobby();
        break;
    }
  });
}

// ---------------- Spielstart ----------------
function startGame() {
  const L = S.lobby;
  if (L.teams.length < 2) return;
  const st = { ...L.settings };
  const seed = Math.floor(Math.random() * 2 ** 31);
  const map = st.map === 'random' ? MAP_TYPES[Math.floor(Math.random() * MAP_TYPES.length)] : st.map;
  const names = shuffle([...MOLE_NAMES]);
  const cfg = {
    seed, map, settings: st,
    teams: L.teams.map(t => ({
      name: t.name, color: t.color, owner: t.kind === 'ai' ? null : t.owner,
      ai: t.kind === 'ai' ? t.diff : null,
      members: Array.from({ length: st.wormsPerTeam }, () => names.pop() || 'Maulwurf'),
    })),
  };
  S.engine = new Engine(cfg);
  S.theme = Math.floor(Math.random() * 3);
  if (S.net) S.net.toAll(startMessage());
  enterGame(S.engine.terrain);
  S.view = S.engine.getView();
  startHostLoop();
}

function startMessage() {
  return { t: 'start', rle: S.engine.terrain.toRLE(), theme: S.theme, maxTeamHp: S.engine.settings.hp * S.engine.settings.wormsPerTeam };
}

function guestStart(d) {
  const terrain = Terrain.fromRLE(MAP_W, MAP_H, d.rle);
  S.theme = d.theme;
  S.snaps = [];
  S.view = null;
  enterGame(terrain, d.maxTeamHp);
}

function enterGame(terrain, maxTeamHp) {
  show('game');
  $('overlay').classList.add('hidden');
  if (!S.renderer) S.renderer = new Renderer($('cv'));
  const R = S.renderer;
  R.particles = []; R.texts = []; R.tracers = []; R.banner = null; R.planes = [];
  R.setTerrain(terrain, S.theme);
  R.cam.x = MAP_W / 2; R.cam.y = MAP_H / 2;
  S.maxTeamHp = maxTeamHp || (S.engine ? S.engine.settings.hp * S.engine.settings.wormsPerTeam : 1);
  S.overShown = false;
  buildWeaponBar();
}

// ---------------- Host-Schleife (Worker-Takt, läuft auch im Hintergrund-Tab) ----------------
let worker = null, lastT = 0, acc = 0, tickSinceSnap = 0, pendingEv = [];
function startHostLoop() {
  stopHostLoop();
  const src = 'let i=setInterval(()=>postMessage(0),1000/60);onmessage=()=>clearInterval(i);';
  worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
  lastT = performance.now(); acc = 0; tickSinceSnap = 0; pendingEv = [];
  worker.onmessage = hostStep;
}
function stopHostLoop() { if (worker) { worker.terminate(); worker = null; } }

function hostStep() {
  const eng = S.engine;
  if (!eng) return;
  const now = performance.now();
  acc = Math.min(acc + (now - lastT), 250);
  lastT = now;
  let n = 0;
  while (acc >= 1000 / 60) {
    acc -= 1000 / 60;
    eng.tick();
    n++;
    tickSinceSnap++;
  }
  if (!n) return;
  const ev = eng.drainEvents();
  const view = eng.getView();
  for (const e of ev) handleEvent(e, view);
  S.view = view;
  if (S.net) {
    pendingEv.push(...ev);
    if (tickSinceSnap >= SNAP_EVERY || pendingEv.length) {
      S.net.toAll({ t: 'snap', v: view, ev: pendingEv });
      pendingEv = [];
      tickSinceSnap = 0;
    }
  }
}

function handleEvent(e, view) {
  S.renderer.onEvent(e, view);
  switch (e.e) {
    case 'boom': play('boom', e.r); break;
    case 'snd': play(e.s); break;
    case 'drown': play('splash'); break;
    case 'splash': play('splash'); break;
    case 'turn': play('turn'); break;
    case 'over': play('win'); break;
  }
}

// ---------------- Gast: interpolierte Ansicht ----------------
function lerp(a, b, t) { return a + (b - a) * t; }
function guestView() {
  const snaps = S.snaps;
  if (!snaps.length) return S.view;
  const rt = performance.now() - INTERP_DELAY;
  for (const s of snaps) {
    if (!s.applied && s.time <= rt) {
      s.applied = true;
      for (const e of s.ev) handleEvent(e, s.view);
    }
  }
  let i = -1;
  for (let k = 0; k < snaps.length; k++) if (snaps[k].time <= rt) i = k;
  if (i < 0) return S.view || null;
  if (i > 0) snaps.splice(0, i);
  const a = snaps[0], b = snaps[1];
  if (!b) return a.view;
  const t = Math.max(0, Math.min(1, (rt - a.time) / Math.max(1, b.time - a.time)));
  const bw = new Map(b.view.worms.map(w => [w.id, w]));
  const be = new Map(b.view.ents.map(e => [e.id, e]));
  return {
    ...a.view,
    worms: a.view.worms.map(w => {
      const o = bw.get(w.id);
      return o ? { ...w, x: lerp(w.x, o.x, t), y: lerp(w.y, o.y, t), aim: lerp(w.aim, o.aim, t) } : w;
    }),
    ents: a.view.ents.map(e => {
      const o = be.get(e.id);
      return o ? { ...e, x: lerp(e.x, o.x, t), y: lerp(e.y, o.y, t) } : e;
    }),
  };
}

// ---------------- Eingaben ----------------
function isMyTurn(view) {
  if (!view || view.cur == null || view.cur < 0) return false;
  const t = view.teams[view.cur];
  return !!t && !t.ai && t.owner === S.myId && (view.phase === 'aim' || view.phase === 'retreat');
}
function sendInput(k, d) {
  if (S.role === 'host') { if (S.engine) S.engine.input(S.myId, k, d); }
  else if (S.net) S.net.toHost({ t: 'in', k, d });
}
function sendAction(a) {
  if (S.role === 'host') { if (S.engine) S.engine.action(S.myId, a); }
  else if (S.net) S.net.toHost({ t: 'act', a });
}

const KEYS = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', ' ': 'fire', Enter: 'jump', Backspace: 'backflip' };
window.addEventListener('keydown', e => {
  if (S.screen !== 'game') return;
  if (e.target instanceof HTMLInputElement) return;
  const k = KEYS[e.key];
  if (k) {
    e.preventDefault();
    if (!e.repeat) sendInput(k, true);
    return;
  }
  if (e.key >= '1' && e.key <= '5') { sendAction({ type: 'fuse', v: +e.key }); return; }
  const key = e.key.toLowerCase();
  if (key === 'q' || key === 'e') cycleWeapon(key === 'e' ? 1 : -1);
  else if (key === 'h') $('helpBox').classList.toggle('hidden');
  else if (key === 'm') toggleMute();
});
window.addEventListener('keyup', e => {
  if (S.screen !== 'game') return;
  const k = KEYS[e.key];
  if (k) { e.preventDefault(); sendInput(k, false); }
});
window.addEventListener('blur', () => { for (const k of Object.values(KEYS)) if (k !== 'fire') sendInput(k, false); });

function cycleWeapon(dir) {
  const v = S.view;
  if (!isMyTurn(v)) return;
  const ammo = v.teams[v.cur].ammo;
  let i = WEAPONS.findIndex(w => w.id === v.weapon);
  for (let k = 0; k < WEAPONS.length; k++) {
    i = (i + dir + WEAPONS.length) % WEAPONS.length;
    if (ammo[WEAPONS[i].id] !== 0) { sendAction({ type: 'weapon', id: WEAPONS[i].id }); return; }
  }
}

// Maus/Touch: Ziehen = Kamera, Klick/Tippen = Ziel, Rad/Pinch = Zoom
const cv = $('cv');
const ptrs = new Map();
let drag = null, pinch = null;
cv.addEventListener('pointerdown', e => {
  initAudio();
  ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  cv.setPointerCapture(e.pointerId);
  if (ptrs.size === 2) {
    const [a, b] = [...ptrs.values()];
    pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1 };
    drag = null;
  } else if (ptrs.size === 1) drag = { x: e.clientX, y: e.clientY, moved: 0 };
});
cv.addEventListener('pointermove', e => {
  if (e.pointerType === 'mouse' && S.renderer) S.hover = S.renderer.screenToWorld(e.clientX, e.clientY);
  const p = ptrs.get(e.pointerId);
  if (!p) return;
  const px = p.x, py = p.y;
  p.x = e.clientX; p.y = e.clientY;
  if (pinch && ptrs.size >= 2) {
    const [a, b] = [...ptrs.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    S.renderer.zoomAt(d / pinch.d, (a.x + b.x) / 2, (a.y + b.y) / 2);
    S.renderer.pan((e.clientX - px) / 2, (e.clientY - py) / 2);
    pinch.d = d;
    return;
  }
  if (!drag) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  drag.moved += Math.abs(dx) + Math.abs(dy);
  drag.x = e.clientX; drag.y = e.clientY;
  if (drag.moved > 10) S.renderer.pan(dx, dy);
});
function endPtr(e) {
  const wasPinch = !!pinch;
  ptrs.delete(e.pointerId);
  if (ptrs.size < 2) pinch = null;
  if (wasPinch) { drag = null; return; }
  if (drag && drag.moved <= 10 && e.type === 'pointerup' && (e.button === 0 || e.pointerType !== 'mouse')) {
    // Die Engine prüft selbst, ob die aktuelle Waffe ein Ziel braucht
    if (isMyTurn(S.view)) {
      const p = S.renderer.screenToWorld(e.clientX, e.clientY);
      sendAction({ type: 'target', x: p.x, y: p.y });
    }
  }
  drag = null;
}
cv.addEventListener('pointerup', endPtr);
cv.addEventListener('pointercancel', endPtr);
cv.addEventListener('wheel', e => {
  e.preventDefault();
  S.renderer.zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX, e.clientY);
}, { passive: false });
cv.addEventListener('contextmenu', e => e.preventDefault());

// Touch-Steuerung (Bildschirmtasten) – automatisch bei Touch-Geräten
const isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0 || matchMedia('(pointer: coarse)').matches;
if (isTouch) {
  document.body.classList.add('touch');
  const held = new Map(); // pointerId -> Taste
  const release = e => {
    const k = held.get(e.pointerId);
    if (!k) return;
    held.delete(e.pointerId);
    e.currentTarget.classList.remove('down');
    sendInput(k, false);
  };
  for (const b of document.querySelectorAll('#touchControls [data-k]')) {
    b.addEventListener('pointerdown', e => {
      e.preventDefault();
      initAudio();
      b.setPointerCapture(e.pointerId);
      held.set(e.pointerId, b.dataset.k);
      b.classList.add('down');
      sendInput(b.dataset.k, true);
      if (navigator.vibrate) navigator.vibrate(8);
    });
    b.addEventListener('pointerup', release);
    b.addEventListener('pointercancel', release);
    b.addEventListener('lostpointercapture', release);
    b.addEventListener('contextmenu', e => e.preventDefault());
  }
  $('tcFuse').addEventListener('click', () => {
    const v = S.view;
    if (!isMyTurn(v)) return;
    sendAction({ type: 'fuse', v: (v.fuse % 5) + 1 });
  });
  window.addEventListener('blur', () => { for (const k of held.values()) sendInput(k, false); held.clear(); });
  document.addEventListener('gesturestart', e => e.preventDefault());
  document.addEventListener('dblclick', e => e.preventDefault());
}

// ---------------- Waffenleiste ----------------
function buildWeaponBar() {
  const bar = $('weaponBar');
  bar.innerHTML = '';
  for (const w of WEAPONS) {
    const b = document.createElement('button');
    b.dataset.id = w.id;
    b.title = `${w.name} – ${w.help}`;
    b.innerHTML = `${w.icon}<span class="ammo"></span>`;
    b.onclick = () => { sendAction({ type: 'weapon', id: w.id }); b.blur(); };
    bar.appendChild(b);
  }
  S.barSig = '';
}

function updateWeaponBar(view) {
  const mine = isMyTurn(view);
  const team = view.teams[view.cur];
  const sig = [mine, view.weapon, view.fuse, view.phase, view.shotsLeft, team && JSON.stringify(team.ammo)].join('|');
  if (sig === S.barSig) return;
  S.barSig = sig;
  const bar = $('weaponBar');
  bar.classList.toggle('inactive', !mine || view.phase !== 'aim');
  const tc = $('touchControls');
  if (tc) {
    tc.classList.toggle('off', !mine);
    const fb = $('tcFuse');
    const wf = WEAPON_BY_ID[view.weapon];
    fb.classList.toggle('hidden', !(wf && wf.fuse));
    fb.textContent = `⏱ ${view.fuse} s`;
  }
  for (const b of bar.children) {
    const id = b.dataset.id;
    const a = team ? team.ammo[id] : -1;
    b.classList.toggle('active', id === view.weapon);
    b.disabled = a === 0;
    b.querySelector('.ammo').textContent = a < 0 ? '' : String(a);
  }
  const wp = WEAPON_BY_ID[view.weapon];
  const info = $('weaponInfo');
  if (wp && team && view.phase !== 'over') {
    let extra = '';
    if (wp.fuse) extra = ` · Zünder: <b>${view.fuse} s</b> (1–5)`;
    if (wp.id === 'shotgun' && view.shotsLeft > 0) extra = ' · <b>2. Schuss!</b>';
    if (wp.target && !view.target && mine) extra = isTouch ? ' · <b>Ziel antippen</b>' : ' · <b>Ziel anklicken</b>';
    info.innerHTML = `${wp.icon} <b>${wp.name}</b> – ${wp.help}${extra}`;
    info.classList.toggle('hidden', !mine);
  } else info.classList.add('hidden');
}

// ---------------- Spielbuttons ----------------
$('btnHelp').onclick = e => { $('helpBox').classList.toggle('hidden'); e.currentTarget.blur(); };
$('btnMute').onclick = e => { toggleMute(); e.currentTarget.blur(); };
function toggleMute() { setMuted(!muted); $('btnMute').textContent = muted ? '🔇' : '🔊'; }
let quitArmed = 0;
$('btnQuit').onclick = e => {
  e.currentTarget.blur();
  if (performance.now() - quitArmed > 3000) {
    quitArmed = performance.now();
    toast(S.role === 'host' && S.net ? 'Nochmal klicken zum Verlassen – die Lobby wird für alle geschlossen.' : 'Nochmal klicken zum Verlassen.', 3000);
    return;
  }
  backToMenu();
};
$('btnBackLobby').onclick = () => {
  if (S.role !== 'host') return;
  stopHostLoop();
  S.engine = null;
  if (S.net) S.net.toAll({ t: 'toLobby' });
  enterLobby();
  lobbyChanged();
};
$('btnBackMenu').onclick = () => backToMenu();

function showGameOver(view) {
  S.overShown = true;
  const w = view.winner;
  const t = w >= 0 ? view.teams[w] : null;
  $('overTitle').textContent = t ? `🏆 ${t.name} gewinnt!` : 'Unentschieden!';
  $('overTitle').style.color = t ? t.color : '#fff';
  const meWon = t && !t.ai && t.owner === S.myId;
  $('overText').textContent = meWon ? 'Glückwunsch – sauber gebuddelt!' : (t ? 'Beim nächsten Mal klappt’s.' : 'Alle Teams sind gleichzeitig untergegangen.');
  $('btnBackLobby').classList.toggle('hidden', S.role !== 'host');
  if (S.role !== 'host') $('overText').textContent += ' Warte auf den Host …';
  $('overlay').classList.remove('hidden');
}

// ---------------- Render-Schleife ----------------
let lastFrame = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  if (S.screen === 'game' && S.renderer) {
    const view = S.role === 'host' ? S.view : guestView();
    if (view) {
      S.view = view;
      const wp = WEAPON_BY_ID[view.weapon];
      const ui = {
        myTurn: isMyTurn(view),
        hoverTarget: wp && wp.target && !view.target ? S.hover : null,
        maxTeamHp: S.maxTeamHp,
      };
      S.renderer.draw(view, dt, ui);
      updateWeaponBar(view);
      if (view.phase === 'over' && !S.overShown) setTimeout(() => showGameOver(view), 1200), S.overShown = true;
    }
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
