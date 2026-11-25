// KI-Gegner: simuliert Schüsse mit der echten Physik und wählt den besten.
// Schwierigkeit = Ungenauigkeit + Waffenauswahl.

const R_WORM = 7;
const DIFF = {
  easy: { aim: 0.13, power: 0.1, weapons: ['bazooka', 'grenade', 'shotgun'], pickTop: 4 },
  medium: { aim: 0.045, power: 0.035, weapons: ['bazooka', 'grenade', 'cluster', 'shotgun', 'bat', 'airstrike'], pickTop: 2 },
  hard: { aim: 0.008, power: 0.008, weapons: ['bazooka', 'grenade', 'cluster', 'shotgun', 'bat', 'airstrike', 'homing'], pickTop: 1 },
};
const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;

export class AIController {
  constructor(eng, diff) {
    this.eng = eng;
    this.d = DIFF[diff] || DIFF.medium;
    this.state = 'wait';
    this.t = 0;
    this.walked = false;
    this.jobs = null;
    this.results = [];
  }

  tick() {
    const eng = this.eng, w = eng.curWorm();
    if (!w) return;
    this.t++;
    switch (this.state) {
      case 'wait':
        if (this.t > 45) this.beginThink();
        break;
      case 'think': {
        // Pro Tick eine Waffe durchrechnen, damit das Spiel nicht ruckelt
        const job = this.jobs.shift();
        if (job) { const r = job(); if (r) this.results.push(...r); break; }
        this.decide(w);
        break;
      }
      case 'walk': {
        this.walkT++;
        const c = eng.controls;
        c.left = this.walkDir < 0; c.right = this.walkDir > 0;
        if (Math.abs(w.x - this.lastX) < 0.01) this.stuck++; else this.stuck = 0;
        this.lastX = w.x;
        if (this.stuck > 15 && w.grounded && !this.jumped) { eng.jump(false); this.jumped = true; this.stuck = 0; }
        const danger = w.grounded && this.cliffAhead(w);
        if (this.walkT > 130 || (this.stuck > 25 && this.jumped) || danger) {
          c.left = c.right = false;
          this.walked = true;
          this.state = 'pause';
          this.t = 0;
        }
        break;
      }
      case 'pause':
        if (this.t > 20 && w.grounded) this.beginThink();
        break;
      case 'prep': {
        const p = this.plan;
        eng.selectWeapon(p.weapon);
        if (eng.weapon !== p.weapon) { this.state = 'skip'; break; }
        eng.fuse = p.fuse || 3;
        if (p.target && p.weapon === 'homing') eng.target = { ...p.target };
        w.facing = p.facing;
        this.state = 'aim';
        this.t = 0;
        break;
      }
      case 'aim': {
        const p = this.plan;
        if (p.aim == null) { this.state = 'fire'; this.t = 0; break; }
        const diff = p.aim - w.aim;
        if (Math.abs(diff) <= 0.022) { w.aim = p.aim; if (this.t > 15) { this.state = 'fire'; this.t = 0; } }
        else w.aim += Math.sign(diff) * 0.022;
        break;
      }
      case 'fire': {
        const p = this.plan;
        if (this.t < 10) break;
        if (p.weapon === 'airstrike' || p.weapon === 'teleport') { eng.setTarget(p.target.x, p.target.y); this.state = 'done'; break; }
        if (!eng.charging) {
          eng.controls.fire = true;
          eng.pressFire();
          if (!eng.charging) {
            eng.controls.fire = false;
            if (p.weapon === 'shotgun' && eng.shotsLeft > 0 && eng.phase === 'aim') { this.walked = true; this.state = 'pause'; this.t = 0; }
            else this.state = 'done';
          }
        } else if (eng.power + 1 / 80 >= p.power) {
          eng.power = p.power;
          eng.controls.fire = false;
          this.state = 'done';
        }
        break;
      }
      case 'skip':
        eng.selectWeapon('skip');
        eng.pressFire();
        this.state = 'done';
        break;
      case 'done':
      default:
        break;
    }
  }

  cliffAhead(w) {
    const eng = this.eng;
    const x = w.x + this.walkDir * 10;
    for (let d = 0; d < 60; d++) if (eng.collides(x, w.y + d)) return false;
    return true;
  }

  beginThink() {
    const eng = this.eng, w = eng.curWorm();
    const team = eng.teams[eng.curTeam];
    this.results = [];
    this.jobs = [];
    const has = id => team.ammo[id] !== 0;
    if (eng.shotsLeft > 0) {
      // Zweiter Schrotschuss: nur Schrotflinte möglich
      this.jobs.push(() => {
        const r = this.searchShotgun(w);
        return r.length ? r : [{ ...this.plan, score: 1 }];
      });
      this.state = 'think';
      return;
    }
    for (const wid of this.d.weapons) {
      if (!has(wid)) continue;
      if (wid === 'bazooka' || wid === 'grenade' || wid === 'cluster') {
        this.jobs.push(() => this.searchProjectile(w, wid, 1));
        this.jobs.push(() => this.searchProjectile(w, wid, -1));
      } else if (wid === 'shotgun') this.jobs.push(() => this.searchShotgun(w));
      else if (wid === 'bat') this.jobs.push(() => this.searchBat(w));
      else if (wid === 'airstrike') this.jobs.push(() => this.searchAirstrike(w));
      else if (wid === 'homing') this.jobs.push(() => this.searchHoming(w));
    }
    this.state = 'think';
  }

  decide(w) {
    const res = this.results.sort((a, b) => b.score - a.score);
    const best = res[0];
    if ((!best || best.score < 12) && !this.walked) {
      const enemies = this.eng.worms.filter(o => o.alive && o.team !== w.team);
      if (enemies.length) {
        enemies.sort((a, b) => Math.abs(a.x - w.x) - Math.abs(b.x - w.x));
        this.walkDir = Math.sign(enemies[0].x - w.x) || 1;
        this.walkT = 0; this.stuck = 0; this.lastX = w.x; this.jumped = false;
        this.state = 'walk';
        return;
      }
    }
    if (!best || best.score < -2) {
      const team = this.eng.teams[this.eng.curTeam];
      if (team.ammo.teleport !== 0) {
        const t = this.eng.findSpawn(60);
        this.plan = { weapon: 'teleport', target: { x: Math.round(t.x), y: Math.round(t.y - 4) }, aim: null, facing: w.facing };
        this.state = 'prep';
      } else this.state = 'skip';
      return;
    }
    const top = res.filter(r => r.score >= best.score - Math.abs(best.score) * 0.4).slice(0, this.d.pickTop);
    const p = { ...top[Math.floor(Math.random() * top.length)] };
    if (p.aim != null && p.weapon !== 'bat') p.aim = Math.max(-1.55, Math.min(1.55, p.aim + gauss() * this.d.aim));
    if (p.power != null) p.power = Math.max(0.08, Math.min(1, p.power * (1 + gauss() * this.d.power)));
    this.plan = p;
    this.state = 'prep';
  }

  simulate(w, wid, facing, aim, power, fuse) {
    const eng = this.eng;
    const e = eng.makeProjectile(wid, w, facing, aim, power, fuse);
    const spec = { rocket: [40, 50], grenade: [40, 50], cluster: [38, 55] }[e.type];
    for (let t = 0; t < 360; t++) {
      const r = eng.stepEntity(e);
      if (r === 'explode') return eng.scoreAt(e.x, e.y, spec[0], spec[1], w);
      if (r === 'remove') return -1;
    }
    return -1;
  }

  searchProjectile(w, wid, facing) {
    const fuses = wid === 'bazooka' ? [3] : [2, 3];
    const out = [];
    for (const fuse of fuses) {
      const cands = [];
      for (let aim = -1.2; aim <= 1.5; aim += 0.1) {
        for (let power = 0.3; power <= 1.001; power += 0.1) {
          cands.push({ aim, power, score: this.simulate(w, wid, facing, aim, power, fuse) });
        }
      }
      cands.sort((a, b) => b.score - a.score);
      for (const c of cands.slice(0, 3)) {
        let best = c;
        for (let da = -0.05; da <= 0.051; da += 0.025) {
          for (let dp = -0.05; dp <= 0.051; dp += 0.025) {
            const aim = c.aim + da, power = Math.min(1, Math.max(0.1, c.power + dp));
            const s = this.simulate(w, wid, facing, aim, power, fuse);
            if (s > best.score) best = { aim, power, score: s };
          }
        }
        out.push({ weapon: wid, facing, aim: best.aim, power: best.power, fuse, score: best.score - (wid === 'cluster' ? 4 : 0) });
      }
    }
    return out;
  }

  // Direkte Sichtlinie zu einem Gegner?
  rayHits(w, dx, dy, target) {
    const eng = this.eng;
    let x = w.x + dx * (R_WORM + 1), y = w.y + dy * (R_WORM + 1);
    for (let i = 0; i < 1000; i++) {
      x += dx; y += dy;
      if (eng.terrain.solid(x, y)) return null;
      for (const o of eng.worms) {
        if (o.alive && o !== w && (o.x - x) ** 2 + (o.y - y) ** 2 < R_WORM * R_WORM) return o;
      }
      if (y > eng.water || x < 0 || x > eng.terrain.w) return null;
    }
    return null;
  }

  searchShotgun(w) {
    const out = [];
    for (const o of this.eng.worms) {
      if (!o.alive || o.team === w.team) continue;
      const dx = o.x - w.x, dy = o.y - w.y, d = Math.hypot(dx, dy);
      if (d > 700) continue;
      const hit = this.rayHits(w, dx / d, dy / d, o);
      if (hit !== o) continue;
      const facing = dx >= 0 ? 1 : -1;
      const aim = Math.asin(Math.max(-1, Math.min(1, -dy / d)));
      out.push({ weapon: 'shotgun', facing, aim, score: 40 + (o.hp <= 50 ? 25 : 0) - d / 100 });
    }
    return out;
  }

  searchBat(w) {
    const out = [];
    for (const o of this.eng.worms) {
      if (!o.alive || o.team === w.team) continue;
      const dx = o.x - w.x, dy = o.y - w.y;
      if (Math.hypot(dx, dy) > 22) continue;
      const facing = dx >= 0 ? 1 : -1;
      out.push({ weapon: 'bat', facing, aim: 0.6, score: 32 + (o.hp <= 30 ? 30 : 0) });
    }
    return out;
  }

  searchAirstrike(w) {
    const eng = this.eng;
    let best = null;
    for (const o of eng.worms) {
      if (!o.alive || o.team === w.team) continue;
      let s = 0;
      for (let i = 0; i < 5; i++) {
        const x = o.x + (i - 2) * 28;
        let y = 0;
        while (y < eng.water && !eng.terrain.solid(x, y) && !eng.worms.some(q => q.alive && (q.x - x) ** 2 + (q.y - y) ** 2 < 81)) y += 2;
        if (y < eng.water) s += eng.scoreAt(x, y, 30, 30, w) * 0.8;
      }
      s -= 15; // sparsam einsetzen
      if (!best || s > best.score) best = { weapon: 'airstrike', target: { x: Math.round(o.x), y: Math.round(o.y) }, aim: null, facing: w.facing, score: s };
    }
    return best ? [best] : [];
  }

  searchHoming(w) {
    const eng = this.eng;
    let best = null;
    for (const o of eng.worms) {
      if (!o.alive || o.team === w.team) continue;
      const target = { x: o.x, y: o.y };
      for (const facing of [1, -1]) {
        const e = eng.makeProjectile('homing', w, facing, 1.2, 0.7, 3, target);
        let s = -1;
        for (let t = 0; t < 360; t++) {
          const r = eng.stepEntity(e);
          if (r === 'explode') { s = eng.scoreAt(e.x, e.y, 40, 50, w); break; }
          if (r === 'remove') break;
        }
        s -= 10;
        if (!best || s > best.score) best = { weapon: 'homing', facing, aim: 1.2, power: 0.7, target, score: s };
      }
    }
    return best ? [best] : [];
  }
}
