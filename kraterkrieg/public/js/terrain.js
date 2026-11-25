// Gelände: Bitmaske (1 = fester Boden), prozedurale Generierung, RLE-Übertragung.

export const MAP_W = 2400;
export const MAP_H = 1000;
export const WATER_Y = 930;

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function valueNoise(rand) {
  const S = 256;
  const g = new Float32Array(S * S);
  for (let i = 0; i < g.length; i++) g[i] = rand();
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const x0 = xi & 255, y0 = yi & 255, x1 = (x0 + 1) & 255, y1 = (y0 + 1) & 255;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = g[y0 * S + x0], b = g[y0 * S + x1], c = g[y1 * S + x0], d = g[y1 * S + x1];
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}

function fbm(n, x, y, oct = 4) {
  let s = 0, amp = 0.5, f = 1, norm = 0;
  for (let o = 0; o < oct; o++) {
    s += amp * n(x * f + o * 31.7, y * f + o * 17.3);
    norm += amp; amp *= 0.5; f *= 2;
  }
  return s / norm;
}

export class Terrain {
  constructor(w, h, mask) {
    this.w = w; this.h = h;
    this.mask = mask || new Uint8Array(w * h);
  }
  solid(x, y) {
    x = x | 0; y = y | 0;
    if (x < 0 || x >= this.w || y < 0 || y >= this.h) return false;
    return this.mask[y * this.w + x] === 1;
  }
  carve(cx, cy, r) {
    const r2 = r * r;
    const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(this.h - 1, Math.ceil(cy + r));
    for (let y = y0; y <= y1; y++) {
      const dy = y - cy;
      const span = Math.sqrt(Math.max(0, r2 - dy * dy));
      const x0 = Math.max(0, Math.floor(cx - span)), x1 = Math.min(this.w - 1, Math.ceil(cx + span));
      this.mask.fill(0, y * this.w + x0, y * this.w + x1 + 1);
    }
  }
  toRLE() {
    const runs = [];
    let cur = 0, len = 0;
    for (let i = 0; i < this.mask.length; i++) {
      if (this.mask[i] === cur) len++;
      else { runs.push(len); cur = this.mask[i]; len = 1; }
    }
    runs.push(len);
    return runs;
  }
  static fromRLE(w, h, runs) {
    const mask = new Uint8Array(w * h);
    let pos = 0, cur = 0;
    for (const len of runs) {
      if (cur) mask.fill(1, pos, pos + len);
      pos += len; cur ^= 1;
    }
    return new Terrain(w, h, mask);
  }
}

export const MAP_TYPES = ['hills', 'islands', 'caves'];

export function generateTerrain(seed, type) {
  if (!MAP_TYPES.includes(type)) type = MAP_TYPES[seed % MAP_TYPES.length];
  const rand = mulberry32(seed);
  const n1 = valueNoise(rand);
  const n2 = valueNoise(rand);
  const W = MAP_W, H = MAP_H, CELL = 4;
  const off = rand() * 100;

  const f = (x, y) => {
    let v;
    if (type === 'hills') {
      const surf = H * 0.52 + (fbm(n1, x / 420 + off, 3.3, 3) - 0.5) * 620;
      v = (y - surf) / 140 + (fbm(n2, x / 110, y / 110) - 0.5) * 1.7;
    } else if (type === 'islands') {
      const yy = (y - H * 0.6) / (H * 0.32);
      v = (fbm(n1, x / 230 + off, y / 200) - 0.5) * 3.6 + 0.32 - yy * yy * 1.4;
      v += (fbm(n2, x / 60, y / 60) - 0.5) * 0.4;
    } else { // caves
      v = (fbm(n1, x / 230 + off, y / 170) - 0.52) * 3.2;
      v += Math.max(0, (110 - y) / 50);          // Decke
      v += Math.max(0, (y - H * 0.84) / 40);     // Boden
      v -= Math.max(0, (260 - y) / 260) * 0.3;
    }
    // Ränder abfallen lassen, Luftraum oben freihalten
    const ex = Math.min(x, W - x);
    v -= Math.max(0, (140 - ex) / 140) * (type === 'hills' ? 9 : 2.0);
    if (type !== 'caves') v -= Math.max(0, (230 - y) / 90);
    return v;
  };

  const gw = W / CELL + 1, gh = H / CELL + 1;
  const field = new Float32Array(gw * gh);
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) field[gy * gw + gx] = f(gx * CELL, gy * CELL);
  }
  const t = new Terrain(W, H);
  for (let y = 0; y < H; y++) {
    const gy = Math.floor(y / CELL), fy = (y % CELL) / CELL;
    for (let x = 0; x < W; x++) {
      const gx = Math.floor(x / CELL), fx = (x % CELL) / CELL;
      const i = gy * gw + gx;
      const a = field[i], b = field[i + 1], c = field[i + gw], d = field[i + gw + 1];
      const v = a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
      if (v > 0) t.mask[y * W + x] = 1;
    }
  }
  // Kleine Krümel entfernen (einzelne schwebende Pixel)
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      if (t.mask[i] && !t.mask[i - 1] && !t.mask[i + 1] && !t.mask[i - W] && !t.mask[i + W]) t.mask[i] = 0;
    }
  }
  return { terrain: t, type };
}
