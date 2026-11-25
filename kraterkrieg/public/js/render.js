// Canvas-Renderer: Gelände, Maulwürfe, Projektile, Partikel, HUD.
import { MAP_W, MAP_H } from './terrain.js';

const THEMES = [
  { name: 'wiese', top: [92, 168, 58], dirt: [122, 82, 52], sky: ['#4f8fd6', '#a9d4f5'], hills: '#6f9fc9', water: [36, 98, 170] },
  { name: 'schnee', top: [236, 242, 250], dirt: [92, 108, 138], sky: ['#3a4f7a', '#9fb7d8'], hills: '#5f739b', water: [40, 80, 130] },
  { name: 'wüste', top: [228, 196, 116], dirt: [176, 112, 66], sky: ['#e58b4c', '#f6d39a'], hills: '#c98a5c', water: [30, 110, 150] },
];

function hash(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.cam = { x: MAP_W / 2, y: MAP_H / 2, zoom: 1 };
    this.particles = [];
    this.texts = [];
    this.tracers = [];
    this.banner = null;
    this.shake = 0;
    this.userPanUntil = 0;
    this.time = 0;
    this.planes = [];
    this.clouds = Array.from({ length: 14 }, (_, i) => ({ x: Math.random() * MAP_W * 1.4 - 200, y: 40 + Math.random() * 260, s: 0.6 + Math.random() * 0.9 }));
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    this.dpr = dpr;
    this.vw = window.innerWidth; this.vh = window.innerHeight;
    this.canvas.width = Math.round(this.vw * dpr);
    this.canvas.height = Math.round(this.vh * dpr);
    this.canvas.style.width = this.vw + 'px';
    this.canvas.style.height = this.vh + 'px';
    this.minZoom = Math.max(0.3, Math.min(this.vw / (MAP_W + 200), this.vh / (MAP_H + 100)));
    if (!this.zoomSet) this.cam.zoom = Math.max(this.minZoom, Math.min(1.6, this.vh / 620));
  }

  setTerrain(terrain, themeIdx) {
    this.theme = THEMES[themeIdx % THEMES.length];
    const { w, h, mask } = terrain;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(w, h);
    const d = img.data;
    const depth = new Uint16Array(w);
    const T = this.theme;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!mask[i]) { depth[x] = 0; continue; }
        const dep = ++depth[x];
        const n = hash(x, y);
        let r, g, b;
        if (dep <= 5) {
          const k = 0.85 + n * 0.25 - dep * 0.02;
          r = T.top[0] * k; g = T.top[1] * k; b = T.top[2] * k;
        } else {
          const band = Math.sin(y * 0.045 + Math.sin(x * 0.01) * 2) * 0.08;
          const big = hash(x >> 3, y >> 3) * 0.12;
          let k = 0.78 + n * 0.16 + band + big;
          if (dep < 9) k *= 0.8;
          r = T.dirt[0] * k; g = T.dirt[1] * k; b = T.dirt[2] * k;
          if (hash(x >> 2, (y >> 2) + 999) > 0.975) { r = g = b = 130 + n * 40; }
        }
        if (y + 1 < h && !mask[i + w]) { r *= 0.65; g *= 0.65; b *= 0.65; }
        const p = i * 4;
        d[p] = r; d[p + 1] = g; d[p + 2] = b; d[p + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    this.terrainCanvas = c;
    this.terrainCtx = ctx;
  }

  carve(x, y, r) {
    if (!this.terrainCtx || r <= 0) return;
    const ctx = this.terrainCtx;
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.globalCompositeOperation = 'source-atop';
    ctx.strokeStyle = 'rgba(35,22,14,0.75)';
    ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(x, y, r + 2, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }

  // ----- Effekte -----
  onEvent(ev, view) {
    switch (ev.e) {
      case 'boom': {
        this.carve(ev.x, ev.y, ev.r);
        const n = Math.min(60, 10 + ev.r);
        for (let i = 0; i < n; i++) {
          const a = Math.random() * Math.PI * 2, s = Math.random() * (2 + ev.r / 12);
          this.particles.push({ x: ev.x, y: ev.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 1.5, life: 40 + Math.random() * 40, max: 80, type: Math.random() < 0.5 ? 'fire' : 'dirt', size: 2 + Math.random() * 3 });
        }
        for (let i = 0; i < 8; i++) this.particles.push({ x: ev.x + (Math.random() - 0.5) * ev.r, y: ev.y + (Math.random() - 0.5) * ev.r, vx: (Math.random() - 0.5) * 0.6, vy: -0.4 - Math.random() * 0.6, life: 90, max: 90, type: 'smoke', size: ev.r * 0.4 + Math.random() * 10 });
        this.particles.push({ x: ev.x, y: ev.y, life: 12, max: 12, type: 'flash', size: ev.r * 1.3 + 10, vx: 0, vy: 0 });
        this.shake = Math.min(18, this.shake + ev.r / 4);
        break;
      }
      case 'dmg': this.texts.push({ x: ev.x, y: ev.y - 24, text: '-' + ev.amt, color: '#ff5a4a', life: 90 }); break;
      case 'pickup': this.texts.push({ x: ev.x, y: ev.y - 24, text: ev.text, color: '#7dff8a', life: 110 }); break;
      case 'drown':
        this.splash(ev.x, ev.y);
        this.showBanner(`${ev.name} ist abgesoffen!`, '#9fd8ff');
        break;
      case 'splash': this.splash(ev.x, ev.y); break;
      case 'death': this.showBanner(`${ev.name} ist hinüber!`, '#ffb0a0'); break;
      case 'tracer': this.tracers.push({ ...ev, life: 14 }); break;
      case 'tele':
        for (let i = 0; i < 30; i++) {
          const a = Math.random() * Math.PI * 2, s = Math.random() * 2.5;
          this.particles.push({ x: ev.x, y: ev.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 40, max: 40, type: 'magic', size: 2 });
        }
        break;
      case 'plane': this.planes.push({ x: ev.dir > 0 ? ev.x - 900 : ev.x + 900, dir: ev.dir, life: 400 }); break;
      case 'msg': this.showBanner(ev.text, '#fff', ev.big ? 180 : 110); break;
      case 'turn': {
        const t = view.teams[ev.team];
        const w = view.worms.find(o => o.id === ev.worm);
        this.showBanner(`${t.name}: ${w ? w.name : ''}`, t.color, 130);
        this.userPanUntil = 0;
        break;
      }
    }
  }

  splash(x, y) {
    for (let i = 0; i < 25; i++) this.particles.push({ x, y, vx: (Math.random() - 0.5) * 3, vy: -2 - Math.random() * 4, life: 50, max: 50, type: 'water', size: 2 + Math.random() * 2 });
  }

  showBanner(text, color, life = 110) { this.banner = { text, color, life, max: life }; }

  // ----- Koordinaten -----
  screenToWorld(sx, sy) {
    return { x: (sx - this.vw / 2) / this.cam.zoom + this.cam.x, y: (sy - this.vh / 2) / this.cam.zoom + this.cam.y };
  }
  pan(dx, dy) {
    this.cam.x -= dx / this.cam.zoom; this.cam.y -= dy / this.cam.zoom;
    this.userPanUntil = performance.now() + 4000;
    this.clampCam();
  }
  zoomAt(factor, sx, sy) {
    const before = this.screenToWorld(sx, sy);
    this.cam.zoom = Math.max(this.minZoom, Math.min(2.5, this.cam.zoom * factor));
    this.zoomSet = true;
    const after = this.screenToWorld(sx, sy);
    this.cam.x += before.x - after.x; this.cam.y += before.y - after.y;
    this.clampCam();
  }
  clampCam() {
    const hw = this.vw / 2 / this.cam.zoom, hh = this.vh / 2 / this.cam.zoom;
    const minX = -150 + hw, maxX = MAP_W + 150 - hw;
    this.cam.x = minX > maxX ? MAP_W / 2 : Math.max(minX, Math.min(maxX, this.cam.x));
    const minY = -250 + hh, maxY = MAP_H + 40 - hh;
    this.cam.y = minY > maxY ? MAP_H / 2 : Math.max(minY, Math.min(maxY, this.cam.y));
  }

  updateCamera(view, dt) {
    let focus = null;
    const flying = view.ents.find(e => !e.rest && e.type !== 'crate' && e.type !== 'mine');
    if (flying) focus = flying;
    else {
      const w = view.worms.find(o => o.id === view.curWorm);
      if (w && w.alive && view.phase !== 'settle') focus = w;
      else {
        const moving = view.worms.find(o => o.alive && !o.grounded);
        if (moving) focus = moving;
      }
    }
    if (flying && flying.id !== this.lastFlying) { this.userPanUntil = 0; this.lastFlying = flying.id; }
    if (focus && performance.now() > this.userPanUntil) {
      const k = 1 - Math.pow(0.9, dt * 60);
      this.cam.x += (focus.x - this.cam.x) * k;
      this.cam.y += (focus.y - this.cam.y) * k;
    }
    this.clampCam();
  }

  // ----- Zeichnen -----
  draw(view, dt, ui) {
    const ctx = this.ctx;
    this.time += dt;
    this.updateCamera(view, dt);
    const z = this.cam.zoom, dpr = this.dpr;
    let sx = 0, sy = 0;
    if (this.shake > 0.2) { sx = (Math.random() - 0.5) * this.shake; sy = (Math.random() - 0.5) * this.shake; this.shake *= Math.pow(0.86, dt * 60); }

    // Himmel
    const T = this.theme || THEMES[0];
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const g = ctx.createLinearGradient(0, 0, 0, this.vh);
    g.addColorStop(0, T.sky[0]); g.addColorStop(1, T.sky[1]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.vw, this.vh);

    // Parallax-Berge
    ctx.fillStyle = T.hills;
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    const px = this.cam.x * 0.3;
    ctx.moveTo(0, this.vh);
    for (let x = 0; x <= this.vw + 20; x += 20) {
      const wx = x + px;
      const yy = this.vh * 0.62 - (Math.sin(wx * 0.004) * 60 + Math.sin(wx * 0.011 + 1) * 30 + Math.sin(wx * 0.0021) * 80) - (this.cam.y - MAP_H / 2) * 0.1 * z;
      ctx.lineTo(x, yy);
    }
    ctx.lineTo(this.vw, this.vh);
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * (this.vw / 2 - this.cam.x * z + sx), dpr * (this.vh / 2 - this.cam.y * z + sy));

    // Wolken (driften mit dem Wind)
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    for (const c of this.clouds) {
      c.x += (view.wind * 1.2 + 0.05) * dt * 60 * c.s;
      if (c.x > MAP_W + 400) c.x = -400; if (c.x < -400) c.x = MAP_W + 400;
      for (const [ox, oy, rx, ry] of [[0, 0, 50, 16], [30, -10, 32, 16], [-28, -5, 26, 12]]) {
        ctx.beginPath();
        ctx.ellipse(c.x + ox * c.s, c.y + oy * c.s, rx * c.s, ry * c.s, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Flugzeuge (Luftangriff)
    for (const p of this.planes) {
      p.x += p.dir * 9 * dt * 60; p.life -= dt * 60;
      this.drawPlane(ctx, p.x, 40, p.dir);
    }
    this.planes = this.planes.filter(p => p.life > 0);

    if (this.terrainCanvas) ctx.drawImage(this.terrainCanvas, 0, 0);

    // Objekte
    for (const e of view.ents) this.drawEnt(ctx, e, view);

    // Maulwürfe
    const cur = view.worms.find(w => w.id === view.curWorm);
    for (const w of view.worms) {
      if (!w.alive) { this.drawGrave(ctx, w); continue; }
      this.drawMole(ctx, w, view.teams[w.team].color, w === cur, view);
    }
    if (cur && cur.alive && view.phase === 'aim') this.drawAim(ctx, cur, view, ui);

    // Zielmarkierung
    if (view.target && view.phase === 'aim') this.drawTarget(ctx, view.target.x, view.target.y, '#ff3b3b');
    if (ui.hoverTarget && ui.myTurn && view.phase === 'aim') this.drawTarget(ctx, ui.hoverTarget.x, ui.hoverTarget.y, 'rgba(255,255,255,0.6)');

    // Tracer
    for (const t of this.tracers) {
      ctx.strokeStyle = `rgba(255,240,160,${t.life / 14})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(t.x1, t.y1); ctx.lineTo(t.x2, t.y2); ctx.stroke();
      t.life -= dt * 60;
    }
    this.tracers = this.tracers.filter(t => t.life > 0);

    this.drawParticles(ctx, dt);
    this.drawWater(ctx, view.water);

    // schwebende Texte
    ctx.textAlign = 'center';
    ctx.font = 'bold 13px system-ui, sans-serif';
    for (const t of this.texts) {
      t.life -= dt * 60; t.y -= 0.4 * dt * 60;
      ctx.globalAlpha = Math.min(1, t.life / 30);
      ctx.lineWidth = 3; ctx.strokeStyle = '#000'; ctx.strokeText(t.text, t.x, t.y);
      ctx.fillStyle = t.color; ctx.fillText(t.text, t.x, t.y);
    }
    ctx.globalAlpha = 1;
    this.texts = this.texts.filter(t => t.life > 0);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.drawHUD(ctx, view, ui, dt);
  }

  drawMole(ctx, w, color, isCur, view) {
    const f = w.facing;
    const bob = isCur && w.grounded ? Math.sin(this.time * 6) * 0.4 : 0;
    ctx.save();
    ctx.translate(w.x, w.y + bob);
    // Körper
    ctx.fillStyle = '#4b3a30';
    ctx.beginPath(); ctx.ellipse(0, 1, 7, 7.5, 0, 0, Math.PI * 2); ctx.fill();
    // Bauch
    ctx.fillStyle = '#8a6c58';
    ctx.beginPath(); ctx.ellipse(f * 2, 3, 3.6, 4.2, 0, 0, Math.PI * 2); ctx.fill();
    // Grabschaufeln (Pfoten)
    ctx.fillStyle = '#f0b6a6';
    ctx.beginPath(); ctx.ellipse(f * 5, 5, 2.6, 1.8, f * 0.4, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(-f * 4, 7, 2.2, 1.5, 0, 0, Math.PI * 2); ctx.fill();
    // Schnauze
    ctx.fillStyle = '#ff8fa3';
    ctx.beginPath(); ctx.ellipse(f * 7.2, -1, 2.6, 2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#d65a76';
    ctx.beginPath(); ctx.arc(f * 8.6, -1.4, 0.9, 0, Math.PI * 2); ctx.fill();
    // Brille / Augen
    ctx.fillStyle = '#111';
    ctx.beginPath(); ctx.arc(f * 3.4, -3, 1.4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(f * 3.8, -3.4, 0.5, 0, Math.PI * 2); ctx.fill();
    // Team-Bauhelm
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.ellipse(0, -4.5, 6.6, 4.2, 0, Math.PI, 0); ctx.fill();
    ctx.fillRect(-7.5 + (f > 0 ? 1 : 0), -5, 14, 1.6);
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillRect(-1, -8.3, 2, 3.5);
    ctx.restore();

    // Name & HP
    ctx.textAlign = 'center';
    ctx.font = 'bold 9px system-ui, sans-serif';
    ctx.lineWidth = 2.5; ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    const ny = w.y - 24;
    ctx.strokeText(w.name, w.x, ny); ctx.fillStyle = color; ctx.fillText(w.name, w.x, ny);
    ctx.font = 'bold 10px system-ui, sans-serif';
    ctx.strokeText(String(w.hp), w.x, ny + 10); ctx.fillStyle = '#fff'; ctx.fillText(String(w.hp), w.x, ny + 10);
    if (isCur && view.phase !== 'settle') {
      const a = Math.sin(this.time * 5) * 2;
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.moveTo(w.x - 4, ny - 16 + a); ctx.lineTo(w.x + 4, ny - 16 + a); ctx.lineTo(w.x, ny - 10 + a); ctx.fill();
    }
  }

  drawGrave(ctx, w) {
    if (w.y > 2000) return;
    ctx.fillStyle = '#9aa0a6';
    ctx.strokeStyle = '#3c4043';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(w.x - 5, w.y + 7); ctx.lineTo(w.x - 5, w.y - 3); ctx.arc(w.x, w.y - 3, 5, Math.PI, 0); ctx.lineTo(w.x + 5, w.y + 7); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#3c4043'; ctx.fillRect(w.x - 0.6, w.y - 5, 1.2, 6); ctx.fillRect(w.x - 2.5, w.y - 3, 5, 1.2);
  }

  drawAim(ctx, w, view, ui) {
    const d = { x: w.facing * Math.cos(w.aim), y: -Math.sin(w.aim) };
    const wp = view.weapon;
    const noAim = ['dynamite', 'mine', 'airstrike', 'teleport', 'skip'].includes(wp);
    if (noAim) return;
    // Waffe
    ctx.strokeStyle = '#2b2b2b'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(w.x + d.x * 3, w.y + d.y * 3); ctx.lineTo(w.x + d.x * 13, w.y + d.y * 13); ctx.stroke();
    // Fadenkreuz
    const cx = w.x + d.x * 48, cy = w.y + d.y * 48;
    ctx.strokeStyle = '#ff3030'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(cx, cy, 5, 0, Math.PI * 2); ctx.moveTo(cx - 8, cy); ctx.lineTo(cx + 8, cy); ctx.moveTo(cx, cy - 8); ctx.lineTo(cx, cy + 8); ctx.stroke();
    // Kraftanzeige
    if (view.charging) {
      const n = Math.round(view.power * 16);
      for (let i = 0; i < n; i++) {
        const t = (i + 1) / 16;
        ctx.fillStyle = `hsl(${60 - t * 60}, 100%, 50%)`;
        ctx.beginPath(); ctx.arc(w.x + d.x * (12 + t * 50), w.y + d.y * (12 + t * 50), 1.2 + t * 3.5, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  drawTarget(ctx, x, y, color) {
    ctx.strokeStyle = color; ctx.lineWidth = 2;
    const r = 9 + Math.sin(this.time * 6) * 2;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - r - 5, y); ctx.lineTo(x + r + 5, y); ctx.moveTo(x, y - r - 5); ctx.lineTo(x, y + r + 5); ctx.stroke();
  }

  drawPlane(ctx, x, y, dir) {
    ctx.save(); ctx.translate(x, y); ctx.scale(dir, 1);
    ctx.fillStyle = '#5b6770';
    ctx.beginPath(); ctx.ellipse(0, 0, 34, 7, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#3e474e';
    ctx.beginPath(); ctx.moveTo(-6, 0); ctx.lineTo(-18, 22); ctx.lineTo(-8, 22); ctx.lineTo(8, 0); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-28, -2); ctx.lineTo(-36, -16); ctx.lineTo(-30, -16); ctx.lineTo(-20, -2); ctx.fill();
    ctx.fillStyle = '#9fd4ff'; ctx.beginPath(); ctx.ellipse(20, -3, 7, 3, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  drawEnt(ctx, e, view) {
    const ang = Math.atan2(e.vy, e.vx);
    switch (e.type) {
      case 'rocket': case 'homing': case 'missile': {
        ctx.save(); ctx.translate(e.x, e.y); ctx.rotate(ang);
        ctx.fillStyle = e.type === 'homing' ? '#c33' : '#556b2f';
        ctx.fillRect(-7, -2.2, 11, 4.4);
        ctx.fillStyle = '#ddd';
        ctx.beginPath(); ctx.moveTo(4, -2.2); ctx.lineTo(8, 0); ctx.lineTo(4, 2.2); ctx.fill();
        ctx.fillStyle = '#333'; ctx.fillRect(-8, -3.5, 3, 7);
        ctx.restore();
        if (Math.random() < 0.8) this.particles.push({ x: e.x - Math.cos(ang) * 8, y: e.y - Math.sin(ang) * 8, vx: (Math.random() - 0.5) * 0.4, vy: (Math.random() - 0.5) * 0.4 - 0.2, life: 35, max: 35, type: 'smoke', size: 3 + Math.random() * 3 });
        break;
      }
      case 'grenade': case 'cluster': case 'bomblet': {
        const r = e.type === 'bomblet' ? 2.5 : 3.6;
        ctx.fillStyle = e.type === 'grenade' ? '#2f5d2a' : e.type === 'cluster' ? '#a22' : '#e0a020';
        ctx.beginPath(); ctx.arc(e.x, e.y - r + 1, r, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#222'; ctx.fillRect(e.x - 1, e.y - r * 2, 2, 2);
        if (e.fuse != null) this.fuseText(ctx, e);
        break;
      }
      case 'dynamite': {
        ctx.fillStyle = '#c62828'; ctx.fillRect(e.x - 2.5, e.y - 11, 5, 11);
        ctx.fillStyle = '#ffeb3b'; ctx.fillRect(e.x - 2.5, e.y - 7, 5, 1.5);
        ctx.strokeStyle = '#333'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(e.x, e.y - 11); ctx.quadraticCurveTo(e.x + 3, e.y - 14, e.x + 2, e.y - 16); ctx.stroke();
        if (Math.random() < 0.7) this.particles.push({ x: e.x + 2, y: e.y - 16, vx: (Math.random() - 0.5), vy: -Math.random(), life: 12, max: 12, type: 'fire', size: 1.5 });
        this.fuseText(ctx, e);
        break;
      }
      case 'mine': {
        ctx.fillStyle = '#333';
        ctx.beginPath(); ctx.ellipse(e.x, e.y - 2.5, 6, 3.2, 0, 0, Math.PI * 2); ctx.fill();
        const blink = e.fuse != null ? Math.sin(this.time * 30) > 0 : (e.armed && Math.sin(this.time * 4) > 0.3);
        ctx.fillStyle = blink ? '#ff2020' : '#661010';
        ctx.beginPath(); ctx.arc(e.x, e.y - 5, 1.6, 0, Math.PI * 2); ctx.fill();
        break;
      }
      case 'crate': {
        const falling = !e.rest && e.vy > 0.5;
        if (falling) {
          ctx.fillStyle = 'rgba(255,255,255,0.9)';
          ctx.beginPath(); ctx.arc(e.x, e.y - 26, 14, Math.PI, 0); ctx.fill();
          ctx.strokeStyle = '#ccc'; ctx.lineWidth = 0.8;
          ctx.beginPath(); ctx.moveTo(e.x - 14, e.y - 26); ctx.lineTo(e.x - 5, e.y - 12); ctx.moveTo(e.x + 14, e.y - 26); ctx.lineTo(e.x + 5, e.y - 12); ctx.stroke();
        }
        if (e.kind === 'health') {
          ctx.fillStyle = '#f4f4f4'; ctx.fillRect(e.x - 6, e.y - 12, 12, 12);
          ctx.fillStyle = '#e53935'; ctx.fillRect(e.x - 1.5, e.y - 10.5, 3, 9); ctx.fillRect(e.x - 4.5, e.y - 7.5, 9, 3);
        } else {
          ctx.fillStyle = '#a06a32'; ctx.fillRect(e.x - 6, e.y - 12, 12, 12);
          ctx.strokeStyle = '#6b4320'; ctx.lineWidth = 1.2; ctx.strokeRect(e.x - 6, e.y - 12, 12, 12);
          ctx.fillStyle = '#fff'; ctx.font = 'bold 9px system-ui'; ctx.textAlign = 'center'; ctx.fillText('?', e.x, e.y - 3);
        }
        break;
      }
    }
  }

  fuseText(ctx, e) {
    ctx.font = 'bold 9px system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.lineWidth = 2; ctx.strokeStyle = '#000';
    const s = String(Math.ceil(e.fuse / 60));
    ctx.strokeText(s, e.x, e.y - 15); ctx.fillStyle = '#fff'; ctx.fillText(s, e.x, e.y - 15);
  }

  drawParticles(ctx, dt) {
    const k = dt * 60;
    for (const p of this.particles) {
      p.life -= k;
      p.x += p.vx * k; p.y += p.vy * k;
      const a = Math.max(0, p.life / p.max);
      switch (p.type) {
        case 'fire': p.vy += 0.08 * k; ctx.fillStyle = `rgba(255,${120 + a * 120 | 0},40,${a})`; break;
        case 'dirt': p.vy += 0.15 * k; ctx.fillStyle = `rgba(90,60,40,${a})`; break;
        case 'smoke': p.size += 0.15 * k; ctx.fillStyle = `rgba(80,80,80,${a * 0.35})`; break;
        case 'water': p.vy += 0.15 * k; ctx.fillStyle = `rgba(170,215,255,${a})`; break;
        case 'magic': ctx.fillStyle = `rgba(190,140,255,${a})`; break;
        case 'flash': ctx.fillStyle = `rgba(255,240,200,${a * 0.8})`; break;
      }
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
    }
    this.particles = this.particles.filter(p => p.life > 0);
    if (this.particles.length > 1500) this.particles.splice(0, this.particles.length - 1500);
  }

  drawWater(ctx, waterY) {
    const T = this.theme || THEMES[0];
    const [r, g, b] = T.water;
    for (let layer = 0; layer < 3; layer++) {
      ctx.fillStyle = `rgba(${r + layer * 10},${g + layer * 15},${b + layer * 10},${0.55 + layer * 0.15})`;
      ctx.beginPath();
      const y0 = waterY + layer * 7;
      ctx.moveTo(-600, MAP_H + 600);
      for (let x = -600; x <= MAP_W + 600; x += 16) {
        ctx.lineTo(x, y0 + Math.sin(x * 0.03 + this.time * (1.5 + layer * 0.5) + layer) * 3);
      }
      ctx.lineTo(MAP_W + 600, MAP_H + 600);
      ctx.fill();
    }
  }

  drawHUD(ctx, view, ui, dt) {
    const W = this.vw;
    const compact = W < 560;           // Hochformat / schmale Handys: zweizeilige Anzeige
    const turnY = compact ? 10 + view.teams.length * 20 + 14 : 10;
    ctx.textBaseline = 'middle';
    // Zug-Info oben Mitte
    const t = view.teams[view.cur];
    const w = view.worms.find(o => o.id === view.curWorm);
    if (t && view.phase !== 'over') {
      const bw = compact ? Math.min(240, W - 120) : 260, bx = W / 2 - bw / 2, ty = turnY - 10;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      this.roundRect(ctx, bx, ty + 10, bw, 46, 10); ctx.fill();
      ctx.fillStyle = t.color; ctx.fillRect(bx + 10, ty + 18, 6, 30);
      ctx.textAlign = 'left'; ctx.font = 'bold 14px system-ui, sans-serif'; ctx.fillStyle = '#fff';
      ctx.fillText(t.name + (t.ai ? ' 🤖' : ''), bx + 24, ty + 26);
      ctx.font = '12px system-ui, sans-serif'; ctx.fillStyle = '#ccc';
      ctx.fillText(w ? w.name : '', bx + 24, ty + 44);
      ctx.textAlign = 'right'; ctx.font = 'bold 26px system-ui, sans-serif';
      let tm = view.timer, col = view.timer <= 5 ? '#ff5252' : '#fff';
      if (view.phase === 'retreat') { tm = view.retreat; col = '#ffd54f'; }
      if (view.phase === 'settle') { tm = '…'; col = '#aaa'; }
      ctx.fillStyle = col; ctx.fillText(String(tm), bx + bw - 14, ty + 34);
    }

    // Wind oben rechts
    {
      const ww = compact ? Math.min(150, W - 230) : 156, bx = W - ww - 14, by = 14;
      const bar = ww - 28, half = bar / 2;
      ctx.fillStyle = 'rgba(0,0,0,0.55)'; this.roundRect(ctx, bx, by, ww, 38, 8); ctx.fill();
      ctx.textAlign = 'left'; ctx.font = '11px system-ui'; ctx.fillStyle = '#ddd'; ctx.fillText('Wind', bx + 8, by + 11);
      const cx = bx + ww / 2, len = view.wind * half;
      ctx.fillStyle = 'rgba(255,255,255,0.15)'; ctx.fillRect(bx + 14, by + 22, bar, 8);
      ctx.fillStyle = view.wind > 0 ? '#4fc3f7' : '#ff8a65';
      ctx.fillRect(Math.min(cx, cx + len), by + 22, Math.abs(len), 8);
      ctx.fillStyle = '#fff'; ctx.fillRect(cx - 0.5, by + 19, 1, 14);
    }

    // Teams oben links
    {
      let y = 14;
      const totals = view.teams.map((tm, i) => ({ tm, i, hp: view.worms.filter(o => o.team === i && o.alive).reduce((s, o) => s + o.hp, 0) }));
      const maxHp = Math.max(1, ...totals.map(x => x.hp), ui.maxTeamHp || 1);
      ctx.fillStyle = 'rgba(0,0,0,0.45)'; this.roundRect(ctx, 10, 8, 200, totals.length * 20 + 10, 8); ctx.fill();
      for (const { tm, i, hp } of totals) {
        ctx.textAlign = 'left'; ctx.font = (i === view.cur ? 'bold ' : '') + '11px system-ui';
        ctx.fillStyle = hp > 0 ? '#fff' : '#777';
        ctx.fillText((tm.name.length > 12 ? tm.name.slice(0, 11) + '…' : tm.name), 18, y + 9);
        ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(100, y + 3, 100, 12);
        ctx.fillStyle = tm.color; ctx.fillRect(100, y + 3, 100 * hp / maxHp, 12);
        ctx.fillStyle = '#fff'; ctx.textAlign = 'right'; ctx.font = '10px system-ui'; ctx.fillText(String(hp), 198, y + 9);
        y += 20;
      }
    }

    // Banner
    if (this.banner) {
      const b = this.banner;
      const by = compact ? turnY + 76 : 96;
      b.life -= dt * 60;
      const a = Math.min(1, b.life / 25, (b.max - b.life) / 10 + 0.2);
      ctx.globalAlpha = Math.max(0, a);
      ctx.textAlign = 'center'; ctx.font = 'bold 26px system-ui, sans-serif';
      ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      ctx.strokeText(b.text, W / 2, by); ctx.fillStyle = b.color; ctx.fillText(b.text, W / 2, by);
      ctx.globalAlpha = 1;
      if (b.life <= 0) this.banner = null;
    }
    if (ui.myTurn && view.phase === 'aim' && !this.banner) {
      ctx.textAlign = 'center'; ctx.font = 'bold 15px system-ui'; ctx.fillStyle = '#fff';
      ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      const my = compact ? turnY + 76 : 78;
      ctx.strokeText('Du bist dran!', W / 2, my); ctx.fillText('Du bist dran!', W / 2, my);
    }
    ctx.textBaseline = 'alphabetic';
  }

  roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
}
