// Spiel-Engine: läuft nur beim Host (bzw. lokal). Gäste bekommen Snapshots.
import { Terrain, generateTerrain, MAP_W, MAP_H, WATER_Y } from './terrain.js';
import { AIController } from './ai.js';

export const G = 0.2;
export const WORM_R = 7;
export const MAX_SPEED = 12.5;
export const WIND_K = 0.02;
const TPS = 60;

export const WEAPONS = [
  { id: 'bazooka', name: 'Bazooka', icon: '🚀', ammo: -1, charge: true, help: 'Rakete – vom Wind beeinflusst' },
  { id: 'homing', name: 'Lenkrakete', icon: '🎯', ammo: 1, charge: true, target: true, help: 'Ziel anklicken, dann mit Leertaste abfeuern' },
  { id: 'grenade', name: 'Granate', icon: '💣', ammo: -1, charge: true, fuse: true, help: 'Zünder 1–5 s (Tasten 1–5), springt ab' },
  { id: 'cluster', name: 'Splitterbombe', icon: '🎆', ammo: 3, charge: true, fuse: true, help: 'Zerplatzt in 5 Splitter' },
  { id: 'shotgun', name: 'Schrotflinte', icon: '🔫', ammo: -1, shots: 2, help: 'Zwei Schüsse pro Zug' },
  { id: 'bat', name: 'Schläger', icon: '🏏', ammo: 2, help: 'Nahkampf – schleudert Gegner weg' },
  { id: 'dynamite', name: 'Dynamit', icon: '🧨', ammo: 1, noAim: true, help: 'Ablegen und weglaufen! (5 s)' },
  { id: 'mine', name: 'Mine', icon: '💠', ammo: 2, noAim: true, help: 'Ablegen – geht hoch, wenn jemand nahe kommt' },
  { id: 'airstrike', name: 'Luftangriff', icon: '✈️', ammo: 1, target: true, noAim: true, help: 'Ziel anklicken – 5 Raketen von oben' },
  { id: 'teleport', name: 'Teleporter', icon: '🌀', ammo: 2, target: true, noAim: true, help: 'Zielort anklicken' },
  { id: 'skip', name: 'Aussetzen', icon: '⏭️', ammo: -1, noAim: true, help: 'Zug beenden' },
];
export const WEAPON_BY_ID = Object.fromEntries(WEAPONS.map(w => [w.id, w]));
const CRATE_WEAPONS = ['homing', 'cluster', 'bat', 'dynamite', 'mine', 'airstrike', 'teleport'];

// Explosionsradius / Schaden / Verhalten der Objekte
export const ENT = {
  rocket: { r: 40, dmg: 50, wind: true, impact: true },
  homing: { r: 40, dmg: 50, impact: true },
  grenade: { r: 40, dmg: 50, bounce: 0.45 },
  cluster: { r: 30, dmg: 30, bounce: 0.45 },
  bomblet: { r: 20, dmg: 20, impact: true },
  dynamite: { r: 70, dmg: 75, bounce: 0.25 },
  mine: { r: 45, dmg: 45, bounce: 0.3 },
  missile: { r: 30, dmg: 30, impact: true },
  crate: { bounce: 0.1 },
};

const OFFS = [];
for (let k = 0; k < 8; k++) OFFS.push([Math.cos(k * Math.PI / 4) * WORM_R, Math.sin(k * Math.PI / 4) * WORM_R]);

const r1 = v => Math.round(v * 10) / 10;

export class Engine {
  /**
   * cfg: { seed, map, settings:{wormsPerTeam,hp,turnTime,mines,crates,suddenDeath},
   *        teams:[{name,color,owner,ai,members:[names]}] }
   */
  constructor(cfg) {
    this.cfg = cfg;
    this.settings = cfg.settings;
    const gen = generateTerrain(cfg.seed, cfg.map);
    this.terrain = gen.terrain;
    this.mapType = gen.type;
    this.water = WATER_Y;
    this.worms = [];
    this.ents = [];
    this.events = [];
    this.nextId = 1;
    this.tickCount = 0;
    this.turnNo = 0;
    this.wind = 0;
    this.winner = null;
    this.controls = { left: false, right: false, up: false, down: false, fire: false };
    this.walkAcc = 0;
    this.teams = cfg.teams.map((t, i) => ({
      idx: i, name: t.name, color: t.color, owner: t.owner, ai: t.ai || null,
      ammo: Object.fromEntries(WEAPONS.map(w => [w.id, w.ammo])), ptr: -1, lastWeapon: 'bazooka',
    }));
    const per = this.settings.wormsPerTeam;
    for (let k = 0; k < per; k++) {
      for (const t of this.teams) {
        const p = this.findSpawn(70);
        const name = (cfg.teams[t.idx].members || [])[k] || `Maulwurf ${k + 1}`;
        this.worms.push({
          id: this.nextId++, team: t.idx, name, x: p.x, y: p.y, vx: 0, vy: 0,
          hp: this.settings.hp, facing: p.x < MAP_W / 2 ? 1 : -1, aim: 0.3, grounded: false, alive: true,
        });
      }
    }
    if (this.settings.mines) {
      for (let i = 0; i < 8; i++) {
        const p = this.findSpawn(45);
        this.ents.push({ id: this.nextId++, type: 'mine', x: p.x, y: p.y, vx: 0, vy: 0, age: 0, fuse: null, arm: 0, rest: false });
      }
    }
    this.curTeam = Math.floor(Math.random() * this.teams.length) - 1;
    this.curWormId = null;
    this.ai = null;
    this.toSettle();
  }

  // ---------- Helfer ----------
  curWorm() { return this.worms.find(w => w.id === this.curWormId) || null; }

  collides(x, y) {
    const t = this.terrain;
    if (t.solid(x, y)) return true;
    for (let k = 0; k < 8; k++) if (t.solid(x + OFFS[k][0], y + OFFS[k][1])) return true;
    return false;
  }

  normalAt(x, y) {
    let nx = 0, ny = 0;
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
      if (dx * dx + dy * dy <= 9 && this.terrain.solid(x + dx, y + dy)) { nx -= dx; ny -= dy; }
    }
    const l = Math.hypot(nx, ny);
    return l ? { x: nx / l, y: ny / l } : { x: 0, y: -1 };
  }

  findSpawn(minDist) {
    for (let attempt = 0; attempt < 400; attempt++) {
      const x = 80 + Math.random() * (MAP_W - 160);
      const cands = [];
      for (let y = 20; y < this.water - 20; y++) {
        if (!this.collides(x, y) && this.collides(x, y + 2)) cands.push(y);
      }
      if (!cands.length) continue;
      const y = cands[Math.floor(Math.random() * cands.length)];
      const tooClose = this.worms.some(w => Math.hypot(w.x - x, w.y - y) < minDist) ||
        this.ents.some(e => Math.hypot(e.x - x, e.y - y) < minDist);
      if (tooClose && attempt < 350) continue;
      return { x, y };
    }
    return { x: MAP_W / 2, y: 100 };
  }

  emit(ev) { this.events.push(ev); }
  drainEvents() { const e = this.events; this.events = []; return e; }

  canControl(pid) {
    const t = this.teams[this.curTeam];
    return !!t && !t.ai && t.owner === pid && (this.phase === 'aim' || this.phase === 'retreat');
  }

  setAI(teamIdx, diff) {
    const t = this.teams[teamIdx];
    if (!t) return;
    t.ai = diff;
    if (teamIdx === this.curTeam && this.phase === 'aim') {
      this.resetControls();
      this.ai = new AIController(this, diff);
    }
  }

  // ---------- Eingaben ----------
  input(pid, key, down) {
    if (!this.canControl(pid)) return;
    if (key in this.controls) this.controls[key] = down;
    if (!down) return;
    if (key === 'fire') this.pressFire();
    else if (key === 'jump') this.jump(false);
    else if (key === 'backflip') this.jump(true);
  }

  action(pid, a) {
    if (!this.canControl(pid)) return;
    if (a.type === 'weapon') this.selectWeapon(a.id);
    else if (a.type === 'fuse') this.fuse = Math.max(1, Math.min(5, a.v | 0));
    else if (a.type === 'target') this.setTarget(+a.x, +a.y);
  }

  resetControls() {
    for (const k in this.controls) this.controls[k] = false;
    this.charging = false;
    this.power = 0;
  }

  selectWeapon(id) {
    const wp = WEAPON_BY_ID[id];
    const team = this.teams[this.curTeam];
    if (!wp || this.phase !== 'aim' || this.charging || this.shotsLeft > 0) return;
    if (team.ammo[id] === 0) return;
    this.weapon = id;
    this.target = null;
    team.lastWeapon = id;
  }

  setTarget(x, y) {
    const wp = WEAPON_BY_ID[this.weapon];
    if (this.phase !== 'aim' || !wp.target || this.charging) return;
    this.target = { x: Math.round(x), y: Math.round(y) };
    if (wp.noAim) this.fire();
  }

  pressFire() {
    if (this.phase !== 'aim' || this.charging) return;
    const wp = WEAPON_BY_ID[this.weapon];
    if (this.teams[this.curTeam].ammo[wp.id] === 0) return;
    if (wp.target && !this.target) { this.emit({ e: 'msg', text: 'Erst ein Ziel anklicken!' }); return; }
    if (wp.charge) { this.charging = true; this.power = 0; }
    else this.fire();
  }

  jump(back) {
    const w = this.curWorm();
    if (!w || !w.grounded || this.charging) return;
    if (back) { w.vx = -w.facing * 1.1; w.vy = -6.2; }
    else { w.vx = w.facing * 2.4; w.vy = -4.2; }
    w.grounded = false;
    w.y -= 1;
    this.emit({ e: 'snd', s: 'jump' });
  }

  walk(w, dir) {
    const nx = w.x + dir;
    let up = -1;
    for (let u = 0; u <= 5; u++) if (!this.collides(nx, w.y - u)) { up = u; break; }
    if (up < 0) return false;
    let ny = w.y - up;
    if (up === 0) {
      let found = false;
      for (let d = 1; d <= 5; d++) if (this.collides(nx, ny + d)) { ny = ny + d - 1; found = true; break; }
      if (!found) { w.x = nx; w.y = ny; w.grounded = false; w.vx = dir * 0.6; w.vy = 0; return true; }
    }
    w.x = nx; w.y = ny;
    return true;
  }

  // ---------- Schießen ----------
  aimDir(facing, aim) { return { x: facing * Math.cos(aim), y: -Math.sin(aim) }; }

  makeProjectile(wid, w, facing, aim, power, fuse, target) {
    const d = this.aimDir(facing, aim);
    const type = { bazooka: 'rocket', homing: 'homing', grenade: 'grenade', cluster: 'cluster' }[wid];
    const sp = power * MAX_SPEED * (type === 'grenade' || type === 'cluster' ? 0.92 : 1);
    const e = {
      id: 0, type, x: w.x + d.x * (WORM_R + 4), y: w.y + d.y * (WORM_R + 4),
      vx: d.x * sp, vy: d.y * sp, age: 0, owner: w.id, rest: false,
      fuse: (type === 'grenade' || type === 'cluster') ? fuse * TPS : null,
    };
    if (!ENT[type].impact && this.terrain.solid(e.x, e.y)) { e.x = w.x; e.y = w.y; }
    if (target) { e.tx = target.x; e.ty = target.y; }
    return e;
  }

  fire() {
    const w = this.curWorm();
    const team = this.teams[this.curTeam];
    const wp = WEAPON_BY_ID[this.weapon];
    if (!w || this.phase !== 'aim') return;
    const power = Math.max(0.05, this.power);
    this.charging = false;
    this.power = 0;
    this.controls.fire = false;
    const d = this.aimDir(w.facing, w.aim);
    let retreat = 3 * TPS;
    switch (wp.id) {
      case 'bazooka': case 'homing': case 'grenade': case 'cluster': {
        const e = this.makeProjectile(wp.id, w, w.facing, w.aim, power, this.fuse, this.target);
        e.id = this.nextId++;
        this.ents.push(e);
        this.emit({ e: 'snd', s: wp.id === 'bazooka' || wp.id === 'homing' ? 'launch' : 'throw' });
        break;
      }
      case 'shotgun': {
        this.shotgun(w, d);
        if (this.shotsLeft === 0) { this.shotsLeft = 1; this.useAmmo(team, wp.id); return; }
        this.shotsLeft = 0;
        this.setRetreat(retreat);
        return;
      }
      case 'bat': {
        const hx = w.x + d.x * 10, hy = w.y + d.y * 10;
        let hit = false;
        for (const o of this.worms) {
          if (!o.alive || o === w) continue;
          if (Math.hypot(o.x - hx, o.y - hy) < 20) {
            o.vx = d.x * 9; o.vy = d.y * 9 - 2.5; o.grounded = false; o.y -= 1;
            this.damage(o, 30);
            hit = true;
          }
        }
        this.emit({ e: 'snd', s: hit ? 'bat' : 'swoosh' });
        this.emit({ e: 'swing', id: w.id });
        break;
      }
      case 'dynamite': case 'mine': {
        const e = {
          id: this.nextId++, type: wp.id, x: w.x + w.facing * 6, y: w.y, vx: w.facing * 0.8, vy: -1.5,
          age: 0, rest: false, fuse: wp.id === 'dynamite' ? 5 * TPS : null, arm: wp.id === 'mine' ? 2 * TPS : 0,
        };
        if (this.terrain.solid(e.x, e.y)) e.x = w.x;
        this.ents.push(e);
        this.emit({ e: 'snd', s: 'throw' });
        retreat = 5 * TPS;
        break;
      }
      case 'airstrike': {
        const tx = this.target.x;
        const dir = Math.random() < 0.5 ? -1 : 1;
        for (let i = 0; i < 5; i++) {
          this.ents.push({
            id: this.nextId++, type: 'missile', x: tx + (i - 2) * 28, y: -60 - i * 30,
            vx: dir * 0.4, vy: 5, age: 0, rest: false, fuse: null,
          });
        }
        this.emit({ e: 'snd', s: 'plane' });
        this.emit({ e: 'plane', x: tx, dir });
        break;
      }
      case 'teleport': {
        const t = this.target;
        if (t.x < 10 || t.x > MAP_W - 10 || t.y < 0 || t.y > this.water - 10 || this.collides(t.x, t.y)) {
          this.target = null;
          this.emit({ e: 'msg', text: 'Da ist kein Platz!' });
          return;
        }
        this.emit({ e: 'tele', x: w.x, y: w.y });
        w.x = t.x; w.y = t.y; w.vx = 0; w.vy = 0; w.grounded = false;
        this.emit({ e: 'tele', x: w.x, y: w.y });
        this.emit({ e: 'snd', s: 'tele' });
        retreat = 2 * TPS;
        break;
      }
      case 'skip':
        this.emit({ e: 'msg', text: `${w.name} setzt aus.` });
        this.toSettle();
        return;
    }
    this.useAmmo(team, wp.id);
    this.setRetreat(retreat);
  }

  useAmmo(team, id) {
    if (team.ammo[id] > 0) team.ammo[id]--;
  }

  setRetreat(t) {
    if (this.phase !== 'aim') return;
    this.phase = 'retreat';
    this.retreat = t;
    this.target = null;
  }

  shotgun(w, d) {
    let x = w.x + d.x * (WORM_R + 1), y = w.y + d.y * (WORM_R + 1);
    const sx = x, sy = y;
    let hit = false;
    for (let i = 0; i < 1000 && !hit; i++) {
      x += d.x; y += d.y;
      if (x < -50 || x > MAP_W + 50 || y < -300 || y > MAP_H) break;
      if (this.terrain.solid(x, y)) { hit = true; break; }
      for (const o of this.worms) {
        if (o.alive && o !== w && (o.x - x) ** 2 + (o.y - y) ** 2 < WORM_R * WORM_R) { hit = true; break; }
      }
    }
    this.emit({ e: 'tracer', x1: r1(sx), y1: r1(sy), x2: r1(x), y2: r1(y) });
    this.emit({ e: 'snd', s: 'shot' });
    if (hit) this.explode(x, y, 14, 25);
  }

  // ---------- Schaden / Explosionen ----------
  damage(w, amt) {
    if (!w.alive || amt <= 0) return;
    w.hp -= amt;
    this.emit({ e: 'dmg', id: w.id, x: r1(w.x), y: r1(w.y), amt });
    if (w.id === this.curWormId && (this.phase === 'aim' || this.phase === 'retreat')) this.toSettle();
  }

  explode(x, y, r, dmg) {
    this.terrain.carve(x, y, r);
    this.emit({ e: 'boom', x: r1(x), y: r1(y), r });
    for (const w of this.worms) {
      if (!w.alive) continue;
      const d = Math.hypot(w.x - x, w.y - y), R = r + WORM_R;
      if (d >= R) continue;
      const f = 1 - d / R;
      let kx = d > 0.5 ? (w.x - x) / d : 0, ky = d > 0.5 ? (w.y - y) / d : -1;
      ky -= 0.6;
      const kl = Math.hypot(kx, ky) || 1;
      const kp = (1.5 + dmg / 9) * f;
      w.vx += kx / kl * kp; w.vy += ky / kl * kp;
      w.grounded = false;
      this.damage(w, Math.round(dmg * Math.min(1, 0.2 + f)));
    }
    for (const e of this.ents) {
      if (e.dead) continue;
      const d = Math.hypot(e.x - x, e.y - y), R = r + 6;
      if (d >= R || ENT[e.type].impact) continue;
      const f = 1 - d / R;
      const kx = d > 0.5 ? (e.x - x) / d : 0, ky = (d > 0.5 ? (e.y - y) / d : -1) - 0.6;
      e.vx += kx * f * 5; e.vy += ky * f * 5;
      e.rest = false;
      if (e.type === 'mine' && e.fuse == null) { e.fuse = 25; }
      if (e.type === 'crate') { e.dead = true; this.emit({ e: 'boom', x: r1(e.x), y: r1(e.y - 6), r: 0 }); }
    }
  }

  // ---------- Physik ----------
  updateWorm(w) {
    if (!w.alive) return;
    if (this.collides(w.x, w.y)) {
      for (let i = 1; i <= WORM_R * 3; i++) if (!this.collides(w.x, w.y - i)) { w.y -= i; break; }
    }
    if (w.grounded && !this.collides(w.x, w.y + 1)) {
      let fell = true;
      for (let d = 2; d <= 3; d++) if (this.collides(w.x, w.y + d)) { w.y += d - 1; fell = false; break; }
      if (fell) { w.grounded = false; w.vx = 0; w.vy = 0; }
    }
    if (!w.grounded) {
      w.vy = Math.min(12, w.vy + G);
      const steps = Math.max(1, Math.ceil(Math.max(Math.abs(w.vx), Math.abs(w.vy))));
      for (let i = 0; i < steps; i++) {
        const nx = w.x + w.vx / steps, ny = w.y + w.vy / steps;
        if (!this.collides(nx, ny)) { w.x = nx; w.y = ny; continue; }
        const hitX = this.collides(nx, w.y), hitY = this.collides(w.x, ny);
        if (hitY && w.vy > 0) { this.land(w); }
        else if (hitY) { w.vy = 0; if (!hitX) w.x = nx; }
        else if (hitX) { w.vx *= -0.35; w.y = ny; }
        else { w.vx *= -0.35; w.vy *= -0.35; }
        break;
      }
    }
    if (w.y > this.water + 4) {
      w.alive = false;
      w.hp = 0;
      this.emit({ e: 'drown', id: w.id, x: r1(w.x), y: this.water, name: w.name });
      if (w.id === this.curWormId && (this.phase === 'aim' || this.phase === 'retreat')) this.toSettle();
    }
  }

  land(w) {
    const impact = w.vy;
    if (impact > 7.5) this.damage(w, Math.round((impact - 7.5) * 8));
    if (Math.abs(w.vx) > 3 || impact > 6) {
      w.vy = -impact * 0.3; w.vx *= 0.6;
      if (w.vy > -1.2) { w.grounded = true; w.vx = 0; w.vy = 0; }
    } else {
      w.grounded = true; w.vx = 0; w.vy = 0;
    }
  }

  // Bewegt ein Objekt um einen Tick. Verändert nur e. Rückgabe: 'explode' | 'remove' | null
  stepEntity(e) {
    const spec = ENT[e.type];
    e.age++;
    if (e.fuse != null) { e.fuse--; if (e.fuse <= 0) return 'explode'; }
    if (e.rest) {
      if (this.terrain.solid(e.x, e.y + 1)) return null;
      e.rest = false;
    }
    if (e.type === 'homing' && e.tx != null && e.age > 25 && e.age < 220) {
      const dx = e.tx - e.x, dy = e.ty - e.y, d = Math.hypot(dx, dy) || 1;
      const sp = Math.max(7, Math.hypot(e.vx, e.vy));
      e.vx += (dx / d * sp - e.vx) * 0.09;
      e.vy += (dy / d * sp - e.vy) * 0.09;
    } else if (e.type === 'crate') {
      e.vy = Math.min(1.6, e.vy + G * 0.5);
      e.vx *= 0.95;
    } else {
      e.vy += G;
      if (spec.wind) e.vx += this.wind * WIND_K;
    }
    const sp = Math.hypot(e.vx, e.vy);
    const steps = Math.max(1, Math.ceil(sp / 1.5));
    for (let i = 0; i < steps; i++) {
      const nx = e.x + e.vx / steps, ny = e.y + e.vy / steps;
      if (spec.impact) {
        if (this.terrain.solid(nx, ny)) { e.x = nx; e.y = ny; return 'explode'; }
        for (const w of this.worms) {
          if (w.alive && (w.id !== e.owner || e.age > 12) && (w.x - nx) ** 2 + (w.y - ny) ** 2 < (WORM_R + 2) ** 2) {
            e.x = nx; e.y = ny; return 'explode';
          }
        }
        e.x = nx; e.y = ny;
      } else {
        if (this.terrain.solid(nx, ny)) {
          const n = this.normalAt(nx, ny);
          const dot = e.vx * n.x + e.vy * n.y;
          if (dot < 0) { e.vx -= 2 * dot * n.x; e.vy -= 2 * dot * n.y; }
          e.vx *= spec.bounce; e.vy *= spec.bounce;
          if (Math.hypot(e.vx, e.vy) < 0.7 && n.y < -0.4) { e.vx = 0; e.vy = 0; e.rest = true; }
          if (this.terrain.solid(e.x, e.y)) { e.x += n.x; e.y += n.y; }
          break;
        }
        e.x = nx; e.y = ny;
      }
    }
    if (!spec.impact && !e.rest) {
      // Haftreibung: sehr langsame Objekte bleiben liegen statt endlos zu rutschen
      if (Math.hypot(e.vx, e.vy) < 0.5 && this.terrain.solid(e.x, e.y + 2)) e.slow = (e.slow || 0) + 1;
      else e.slow = 0;
      if (e.slow > 30) { e.vx = 0; e.vy = 0; e.rest = true; e.slow = 0; }
    }
    if (e.y > this.water + 6 || e.x < -500 || e.x > MAP_W + 500) return 'remove';
    return null;
  }

  // ---------- Zug-Ablauf ----------
  toSettle() {
    this.phase = 'settle';
    this.settleTicks = 0;
    this.calmTicks = 0;
    this.target = null;
    this.ai = null;
    this.resetControls();
  }

  isCalm() {
    for (const e of this.ents) {
      if (e.type === 'mine') { if (e.fuse != null || !e.rest) return false; }
      else if (e.type === 'crate') { if (!e.rest) return false; }
      else return false;
    }
    return this.worms.every(w => !w.alive || w.grounded);
  }

  aliveTeams() {
    return this.teams.filter(t => this.worms.some(w => w.alive && w.team === t.idx));
  }

  startTurn() {
    this.turnNo++;
    const n = this.teams.length;
    let ti = -1;
    for (let k = 1; k <= n; k++) {
      const t = ((this.curTeam + k) % n + n) % n;
      if (this.worms.some(w => w.alive && w.team === t)) { ti = t; break; }
    }
    const team = this.teams[ti];
    const members = this.worms.filter(w => w.team === ti);
    let wi = team.ptr;
    for (let k = 1; k <= members.length; k++) {
      const j = (team.ptr + k) % members.length;
      if (members[j].alive) { wi = j; break; }
    }
    team.ptr = wi;
    this.curTeam = ti;
    this.curWormId = members[wi].id;
    this.wind = Math.round((Math.random() * 2 - 1) * 100) / 100;
    this.phase = 'aim';
    this.timer = this.settings.turnTime * TPS;
    this.weapon = team.ammo[team.lastWeapon] !== 0 ? team.lastWeapon : 'bazooka';
    this.target = null;
    this.shotsLeft = 0;
    this.fuse = 3;
    this.walkAcc = 0;
    this.resetControls();

    // Sudden Death: Wasser steigt
    const round = Math.floor((this.turnNo - 1) / Math.max(1, this.aliveTeams().length)) + 1;
    if (this.settings.suddenDeath > 0 && round > this.settings.suddenDeath) {
      this.water -= 14;
      if (!this.sudden) { this.sudden = true; this.emit({ e: 'msg', text: 'Sudden Death – das Wasser steigt!', big: true }); }
    }

    if (this.settings.crates && Math.random() < 0.4) {
      const p = this.findSpawn(0);
      this.ents.push({
        id: this.nextId++, type: 'crate', kind: Math.random() < 0.5 ? 'health' : 'weapon',
        x: p.x, y: -20, vx: 0, vy: 0, age: 0, rest: false, fuse: null,
      });
      this.emit({ e: 'snd', s: 'crate' });
    }
    this.emit({ e: 'turn', team: ti, worm: this.curWormId });
    this.ai = team.ai ? new AIController(this, team.ai) : null;
  }

  settleStep() {
    this.settleTicks++;
    if (!this.isCalm() && this.settleTicks < TPS * 20) { this.calmTicks = 0; return; }
    if (++this.calmTicks < 25) return;
    const dying = this.worms.find(w => w.alive && w.hp <= 0);
    if (dying) {
      dying.alive = false;
      dying.hp = 0;
      this.emit({ e: 'death', id: dying.id, name: dying.name, x: r1(dying.x), y: r1(dying.y) });
      this.explode(dying.x, dying.y, 22, 15);
      this.calmTicks = 0;
      return;
    }
    const alive = this.aliveTeams();
    if (alive.length <= 1) {
      this.phase = 'over';
      this.winner = alive.length ? alive[0].idx : -1;
      this.emit({ e: 'over', winner: this.winner });
      return;
    }
    this.startTurn();
  }

  tick() {
    this.tickCount++;
    const w = this.curWorm();
    const active = (this.phase === 'aim' || this.phase === 'retreat') && w && w.alive;
    if (active && this.ai && this.phase === 'aim') this.ai.tick();
    if (active) this.handleControls(w);

    for (const worm of this.worms) this.updateWorm(worm);

    for (const e of this.ents.slice()) {
      if (e.dead) continue;
      if (e.type === 'mine') {
        if (e.arm > 0) e.arm--;
        else if (e.fuse == null && this.worms.some(o => o.alive && Math.hypot(o.x - e.x, o.y - (e.y - 3)) < 22)) {
          e.fuse = TPS;
          this.emit({ e: 'snd', s: 'beep' });
        }
      }
      if (e.type === 'crate') {
        const o = this.worms.find(o => o.alive && Math.hypot(o.x - e.x, o.y - (e.y - 6)) < 15);
        if (o) { this.collectCrate(o, e); continue; }
      }
      const res = this.stepEntity(e);
      if (res === 'explode') {
        e.dead = true;
        const spec = ENT[e.type];
        this.explode(e.x, e.y, spec.r, spec.dmg);
        if (e.type === 'cluster') {
          for (let i = 0; i < 5; i++) {
            this.ents.push({
              id: this.nextId++, type: 'bomblet', x: e.x, y: e.y - 4,
              vx: (Math.random() * 2 - 1) * 3, vy: -2.5 - Math.random() * 3, age: 20, rest: false, fuse: null,
            });
          }
        }
      } else if (res === 'remove') {
        e.dead = true;
        if (e.y > this.water) this.emit({ e: 'splash', x: r1(e.x), y: this.water });
      }
    }
    this.ents = this.ents.filter(e => !e.dead);

    if (this.phase === 'aim') {
      if (--this.timer <= 0) { this.emit({ e: 'msg', text: 'Zeit abgelaufen!' }); this.toSettle(); }
    } else if (this.phase === 'retreat') {
      if (--this.retreat <= 0) this.toSettle();
    } else if (this.phase === 'settle') {
      this.settleStep();
    }
  }

  handleControls(w) {
    const c = this.controls;
    if (w.grounded && !this.charging && (c.left !== c.right)) {
      const dir = c.left ? -1 : 1;
      if (w.facing !== dir) { w.facing = dir; this.walkAcc = -2; }
      else {
        this.walkAcc += 0.6;
        while (this.walkAcc >= 1) { this.walkAcc -= 1; if (!this.walk(w, dir)) { this.walkAcc = 0; break; } }
      }
    }
    if (this.phase !== 'aim') return;
    if (c.up) w.aim = Math.min(1.55, w.aim + 0.022);
    if (c.down) w.aim = Math.max(-1.55, w.aim - 0.022);
    if (this.charging) {
      if (!c.fire) this.fire();
      else { this.power = Math.min(1, this.power + 1 / 80); if (this.power >= 1) this.fire(); }
    }
  }

  collectCrate(w, e) {
    e.dead = true;
    if (e.kind === 'health') {
      w.hp += 25;
      this.emit({ e: 'pickup', id: w.id, x: r1(w.x), y: r1(w.y), text: '+25 ❤' });
    } else {
      const id = CRATE_WEAPONS[Math.floor(Math.random() * CRATE_WEAPONS.length)];
      const t = this.teams[w.team];
      if (t.ammo[id] >= 0) t.ammo[id]++;
      const wp = WEAPON_BY_ID[id];
      this.emit({ e: 'pickup', id: w.id, x: r1(w.x), y: r1(w.y), text: `${wp.icon} ${wp.name}` });
    }
    this.emit({ e: 'snd', s: 'pickup' });
  }

  // KI-Hilfe: Erwarteter Nutzen einer Explosion aus Sicht des Maulwurfs w
  scoreAt(x, y, r, dmg, w) {
    let s = 0, dmin = Infinity;
    for (const o of this.worms) {
      if (!o.alive) continue;
      const d = Math.hypot(o.x - x, o.y - y), R = r + WORM_R;
      if (o.team !== w.team) dmin = Math.min(dmin, d);
      if (d >= R) continue;
      const amt = dmg * Math.min(1, 0.2 + (1 - d / R));
      if (o.team !== w.team) {
        s += Math.min(amt, Math.max(0, o.hp));
        if (amt >= o.hp && o.hp > 0) s += 30;
      } else if (o === w) s -= amt * 2 + (amt >= o.hp ? 200 : 0);
      else s -= amt * 1.3 + (amt >= o.hp ? 40 : 0);
    }
    if (dmin < 500) s += (500 - dmin) / 80;
    return s;
  }

  // ---------- Snapshot ----------
  getView() {
    return {
      tick: this.tickCount, phase: this.phase, timer: Math.ceil((this.timer || 0) / TPS),
      retreat: Math.ceil((this.retreat || 0) / TPS), wind: this.wind, water: this.water,
      cur: this.curTeam, curWorm: this.curWormId, weapon: this.weapon, power: Math.round((this.power || 0) * 100) / 100,
      charging: !!this.charging, fuse: this.fuse, target: this.target, shotsLeft: this.shotsLeft,
      winner: this.winner, sudden: !!this.sudden,
      worms: this.worms.map(w => ({
        id: w.id, team: w.team, name: w.name, x: r1(w.x), y: r1(w.y), hp: Math.max(0, w.hp),
        facing: w.facing, aim: Math.round(w.aim * 1000) / 1000, alive: w.alive, grounded: w.grounded,
      })),
      ents: this.ents.map(e => ({
        id: e.id, type: e.type, x: r1(e.x), y: r1(e.y), vx: r1(e.vx), vy: r1(e.vy),
        fuse: e.fuse, rest: e.rest, kind: e.kind, armed: e.type === 'mine' ? e.arm <= 0 : undefined,
      })),
      teams: this.teams.map(t => ({ name: t.name, color: t.color, owner: t.owner, ai: t.ai, ammo: t.ammo })),
    };
  }
}

export { Terrain, MAP_W, MAP_H, WATER_Y };
