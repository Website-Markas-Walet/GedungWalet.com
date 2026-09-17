// Geometri turunan satu lantai: batas lantai, bukaan yang memotong dinding (LAR, LMB, pintu), RUANG BERDASARKAN SEKAT
// (area yang dikelilingi sekat = satu ruang; sekat yang menempel otomatis tersambung; LAR & celah bawah sekat gantung =
// pintunya), jalan keluar tiap ruang ke arah void, fungsi LAR (inap/jalur/void), ruang inap (zona dibagi sekat),
// arah hadap tweeter, rantai tweeter tarik (tidak menembus sekat), dan papan sirip.
import { RULES, ROLE_ORDER } from './planner-data.js';

export const WALL_T = { ext: 0.2, sekat: 0.12 };
export const isLar = t => t === 'lar' || t === 'larj';
export const LAR_FN = ['inap', 'jalur', 'void'];
const CUTS_SEKAT = new Set(['lar', 'larj', 'pintu']);   // LAR hanya memotong sekat
const CUTS_EXT = new Set(['lmb', 'pintu']);             // LMB & pintu memotong dinding luar
const r2 = v => Math.round(v * 100) / 100;
const lim = (v, a, b) => Math.min(b, Math.max(a, v));

export const center = it => ({ x: it.x + it.w / 2, y: it.y + it.h / 2 });
export const inRect = (p, r, pad = 0) => p.x >= r.x - pad && p.x <= r.x + r.w + pad && p.y >= r.y - pad && p.y <= r.y + r.h + pad;
export const ovArea = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const distToRect = (p, r) => Math.hypot(Math.max(r.x - p.x, 0, p.x - (r.x + r.w)), Math.max(r.y - p.y, 0, p.y - (r.y + r.h)));
// Sudut layar: 0° = kanan, 90° = belakang (bawah), 180° = kiri, 270° = depan (atas).
export const angleTo = (a, b) => ((Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI + 360) % 360;
export const angDiff = (a, b) => Math.abs((((a - b) % 360) + 540) % 360 - 180);
export const snap90 = d => (((Math.round(d / 90) * 90) % 360) + 360) % 360;
export const SIDE_DIR = { top: 270, bottom: 90, left: 180, right: 0 };
const nearest = (p, list, f = center) => list.reduce((best, it) => { const d = dist(p, f(it)); return !best || d < best.d ? { it, d } : best; }, null);
// dua ruas garis saling memotong (menyentuh di ujung tidak dihitung)
function segCross(a, b, c, d) {
  const o = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x), e = 1e-9;
  const d1 = o(c, d, a), d2 = o(c, d, b), d3 = o(a, b, c), d4 = o(a, b, d);
  return ((d1 > e && d2 < -e) || (d1 < -e && d2 > e)) && ((d3 > e && d4 < -e) || (d3 < -e && d4 > e));
}

// ---------- batas & tinggi lantai ----------
// Default seluas gedung; bisa lebih kecil dan bergeser (mis. lantai atas 10×15 m di tengah gedung 20×25 m).
export function floorRect(m, fl) {
  const w = lim(+(fl?.fw ?? m.w) || m.w, 1, m.w), h = lim(+(fl?.fh ?? m.h) || m.h, 1, m.h);
  return { x: lim(+(fl?.fx ?? 0) || 0, 0, m.w - w), y: lim(+(fl?.fy ?? 0) || 0, 0, m.h - h), w, h };
}
export const floorHt = (m, fl) => lim(+(fl?.ht ?? m.floorH) || m.floorH, 1.5, 6);
// Lantai + lantai menara (bila ada): menara punya denah sendiri di atas lantai teratas.
export const levels = m => (m.menara ? m.floors.concat([m.menara]) : m.floors);
export const isFull = (m, fl) => { const F = floorRect(m, fl); return F.x === 0 && F.y === 0 && F.w === m.w && F.h === m.h; };
// Tweeter hexagonal menempel di sisi dalam LMB terdekat (menara atau lantai ber-LMB) — di atap tepat di atas lubangnya.
export function snapHexa(it, m, fl) {
  const F = floorRect(m, fl), l = nearest(center(it), fl.items.filter(z => z.t === 'lmb'));
  if (!l || l.d > 3) return false;
  const lc = center(l.it), e = [[lc.y - F.y, 0, 1], [F.y + F.h - lc.y, 0, -1], [lc.x - F.x, 1, 0], [F.x + F.w - lc.x, -1, 0]].reduce((p, q) => (q[0] < p[0] ? q : p));
  let [off, nx, ny] = e;
  if (off > 0.5) { const hz = l.it.w >= l.it.h; off = 0; nx = hz ? 0 : Math.sign(F.x + F.w / 2 - lc.x) || 1; ny = hz ? Math.sign(F.y + F.h / 2 - lc.y) || 1 : 0; }
  const d = 0.2 + it.w / 2, cx = lc.x - nx * off + nx * d, cy = lc.y - ny * off + ny * d;   // tebal kusen LMB + jari-jari hexagonal
  it.x = r2(lim(cx - it.w / 2, F.x, F.x + F.w - it.w)); it.y = r2(lim(cy - it.h / 2, F.y, F.y + F.h - it.h));
  return true;
}
export function intersect(rects) {
  const x0 = Math.max(...rects.map(r => r.x)), y0 = Math.max(...rects.map(r => r.y));
  const x1 = Math.min(...rects.map(r => r.x + r.w)), y1 = Math.min(...rects.map(r => r.y + r.h));
  return x1 - x0 > 0.5 && y1 - y0 > 0.5 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}
// a dikurangi b → daftar persegi (bagian dak lantai bawah yang tidak tertutup lantai di atasnya)
export function rectDiff(a, b) {
  const ix0 = Math.max(a.x, b.x), iy0 = Math.max(a.y, b.y), ix1 = Math.min(a.x + a.w, b.x + b.w), iy1 = Math.min(a.y + a.h, b.y + b.h);
  if (ix1 <= ix0 || iy1 <= iy0) return [a];
  const out = [];
  if (iy0 > a.y) out.push({ x: a.x, y: a.y, w: a.w, h: iy0 - a.y });
  if (iy1 < a.y + a.h) out.push({ x: a.x, y: iy1, w: a.w, h: a.y + a.h - iy1 });
  if (ix0 > a.x) out.push({ x: a.x, y: iy0, w: ix0 - a.x, h: iy1 - iy0 });
  if (ix1 < a.x + a.w) out.push({ x: ix1, y: iy0, w: a.x + a.w - ix1, h: iy1 - iy0 });
  return out.filter(r => r.w > 0.01 && r.h > 0.01);
}
export function clampInto(it, F) {
  it.w = r2(Math.min(it.w, F.w)); it.h = r2(Math.min(it.h, F.h));
  it.x = r2(lim(it.x, F.x, F.x + F.w - it.w)); it.y = r2(lim(it.y, F.y, F.y + F.h - it.h));
  return it;
}

// ---------- dinding & bukaan ----------
// Dinding luar lantai ini (4 sisi, searah jarum jam) + sekat.
export function wallSegs(m, fl) {
  const F = floorRect(m, fl), x0 = F.x, y0 = F.y, x1 = F.x + F.w, y1 = F.y + F.h;
  const ext = [[x0, y0, x1, y0], [x1, y0, x1, y1], [x1, y1, x0, y1], [x0, y1, x0, y0]]
    .map((c, i) => ({ id: 'ext' + i, ext: true, x1: c[0], y1: c[1], x2: c[2], y2: c[3], jenis: 'penuh' }));
  return ext.concat(fl.walls.map(s => ({ ...s, ext: false })));
}

// Bukaan yang menempel pada segmen → interval [a, b] (meter dari titik awal segmen).
export function openingsOn(seg, fl) {
  const dx = seg.x2 - seg.x1, dy = seg.y2 - seg.y1, len = Math.hypot(dx, dy);
  if (len < 0.01) return [];
  const ux = dx / len, uy = dy / len, horiz = Math.abs(ux) >= Math.abs(uy), out = [];
  for (const it of fl.items) {
    if (!(seg.ext ? CUTS_EXT : CUTS_SEKAT).has(it.t)) continue;
    if (horiz ? it.w < it.h : it.h < it.w) continue;                      // harus sejajar dinding
    const c = center(it), perp = Math.abs((c.x - seg.x1) * uy - (c.y - seg.y1) * ux);
    if (perp > Math.max(0.25, Math.min(it.w, it.h) / 2 + 0.12)) continue;
    const t = (c.x - seg.x1) * ux + (c.y - seg.y1) * uy, L = Math.max(it.w, it.h);
    const a = Math.max(0, t - L / 2), b = Math.min(len, t + L / 2);
    if (b - a < 0.05) continue;
    out.push({ a, b, it, kind: it.t === 'larj' ? 'jendela' : it.t === 'lar' ? 'pintu' : it.t });
  }
  return out.sort((p, q) => p.a - q.a);
}

// Bagian dinding yang tetap utuh setelah dikurangi bukaan.
export function solidPieces(len, ops) {
  const res = []; let pos = 0;
  for (const o of ops) { if (o.a > pos + 0.01) res.push([pos, o.a]); pos = Math.max(pos, o.b); }
  if (len > pos + 0.01) res.push([pos, len]);
  return res;
}

// Tempelkan LAR ke sekat terdekat; LMB & ventilasi ke dinding luar; pintu ke keduanya (jarak ≤ 0,6 m).
export function snapToWall(it, m, fl) {
  const kinds = isLar(it.t) ? ['sekat'] : it.t === 'lmb' || it.t === 'vent' ? ['ext'] : it.t === 'pintu' ? ['ext', 'sekat'] : null;
  if (!kinds) return false;
  const F = floorRect(m, fl), c = center(it); let best = null;
  for (const s of wallSegs(m, fl)) {
    if (!kinds.includes(s.ext ? 'ext' : 'sekat')) continue;
    const dx = s.x2 - s.x1, dy = s.y2 - s.y1, len = Math.hypot(dx, dy); if (len < 0.3) continue;
    const ux = dx / len, uy = dy / len, t = Math.max(0, Math.min(len, (c.x - s.x1) * ux + (c.y - s.y1) * uy));
    const d = Math.hypot(c.x - (s.x1 + ux * t), c.y - (s.y1 + uy * t));
    if (d <= 0.6 && (!best || d < best.d)) best = { s, ux, uy, len, t, d };
  }
  if (!best) return false;
  const { s, ux, uy, len } = best, horiz = Math.abs(ux) >= Math.abs(uy);
  const L = it.t === 'vent' ? 0.15 : Math.max(it.w, it.h), T = it.t === 'vent' ? 0.3 : Math.min(it.w, it.h);
  const t = len >= L ? Math.max(L / 2, Math.min(len - L / 2, best.t)) : len / 2;
  let cx = s.x1 + ux * t, cy = s.y1 + uy * t;
  if (it.t === 'vent') { // pipa menjorok ke dalam lantai dari muka dinding
    let nx = -uy, ny = ux; if ((F.x + F.w / 2 - cx) * nx + (F.y + F.h / 2 - cy) * ny < 0) { nx = -nx; ny = -ny; }
    cx += nx * T / 2; cy += ny * T / 2;
  }
  const w = horiz ? L : T, h = horiz ? T : L;
  Object.assign(it, { w: r2(w), h: r2(h), x: r2(lim(cx - w / 2, F.x, F.x + F.w - w)), y: r2(lim(cy - h / 2, F.y, F.y + F.h - h)) });
  return true;
}

// Tweeter yang tertimpa sekat/dinding digeser tegak lurus keluar dari garisnya (bukaan LAR tidak dihitung).
export function pushOffWalls(it, segs, F) {
  const c = center(it), half = Math.max(it.w, it.h) / 2; let moved = false;
  for (const s of segs) {
    if (s.len < 0.05) continue;
    const ux = (s.x2 - s.x1) / s.len, uy = (s.y2 - s.y1) / s.len, t = (c.x - s.x1) * ux + (c.y - s.y1) * uy;
    if (!(s.pieces || [[0, s.len]]).some(([a, b]) => t > a - half && t < b + half)) continue;
    const off = (c.x - s.x1) * -uy + (c.y - s.y1) * ux, need = half + (s.ext ? WALL_T.ext : WALL_T.sekat) / 2 + 0.03;
    if (Math.abs(off) >= need) continue;
    let sg = off >= 0 ? 1 : -1;
    if (s.ext) sg = ((F.x + F.w / 2 - s.x1) * -uy + (F.y + F.h / 2 - s.y1) * ux) >= 0 ? 1 : -1;   // dinding luar: selalu ke dalam
    const dd = sg * need - off;
    c.x += -uy * dd; c.y += ux * dd; moved = true;
  }
  if (moved) { it.x = r2(lim(c.x - it.w / 2, F.x, F.x + F.w - it.w)); it.y = r2(lim(c.y - it.h / 2, F.y, F.y + F.h - it.h)); }
  return moved;
}

// ---------- ruang berdasarkan sekat ----------
// Grid sel ≤ 0,25 m: sekat (dan bukaan LAR) memisahkan sel; sel yang terhubung = satu ruang. Karena sekat digambar
// setebal sel, sekat yang saling menempel otomatis tersambung. Geometri disimpan per bentuk sekat/LAR (cache).
const SP_GEO = new Map();
const SP_PRIO = ['void', 'inap', 'audio', 'jalur'];
const SP_NAMA = { void: 'Ruang void', inap: 'Ruang inap', jalur: 'Ruang jalur', audio: 'Ruang audio', lain: 'Ruang' };
const SP_OFFS = (() => { const o = []; for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) o.push([i, j]); return o.sort((p, q) => Math.hypot(...p) - Math.hypot(...q)); })();
const JOIN = 0.25;   // ujung sekat yang kurang dari 25 cm dari dinding / sekat lain dianggap tersambung
function joinEnds(walls, F) {
  const ws = walls.map(w => ({ ...w })), hz = w => Math.abs(w.y2 - w.y1) < 0.01, vt = w => Math.abs(w.x2 - w.x1) < 0.01;
  ws.forEach(s => [1, 2].forEach(k => {
    const o = k === 1 ? 2 : 1, x = s['x' + k], y = s['y' + k], dx = Math.sign(x - s['x' + o]), dy = Math.sign(y - s['y' + o]);
    let best = null;
    const take = (gap, v) => { if (gap > 0.005 && gap <= JOIN && (!best || gap < best.gap)) best = { gap, v }; };
    if (hz(s) && dx) {   // sekat mendatar: dinding luar kiri/kanan, sekat tegak di depannya, atau sekat mendatar segaris
      [F.x, F.x + F.w].forEach(c => take((c - x) * dx, c));
      ws.forEach(l => { if (l === s) return;
        if (vt(l) && y >= Math.min(l.y1, l.y2) - 0.05 && y <= Math.max(l.y1, l.y2) + 0.05) take((l.x1 - x) * dx, l.x1);
        if (hz(l) && Math.abs(l.y1 - y) <= 0.05) [l.x1, l.x2].forEach(c => take((c - x) * dx, c)); });
      if (best) s['x' + k] = best.v;
    } else if (vt(s) && dy) {
      [F.y, F.y + F.h].forEach(c => take((c - y) * dy, c));
      ws.forEach(l => { if (l === s) return;
        if (hz(l) && x >= Math.min(l.x1, l.x2) - 0.05 && x <= Math.max(l.x1, l.x2) + 0.05) take((l.y1 - y) * dy, l.y1);
        if (vt(l) && Math.abs(l.x1 - x) <= 0.05) [l.y1, l.y2].forEach(c => take((c - y) * dy, c)); });
      if (best) s['y' + k] = best.v;
    }
  }));
  return ws;
}
function spaceGeom(m, fl, F) {
  const key = JSON.stringify([F, fl.walls.map(w => [w.id, w.x1, w.y1, w.x2, w.y2, w.jenis === 'gantung' ? 1 : 0]), fl.items.filter(it => CUTS_SEKAT.has(it.t)).map(it => [it.id, it.t, it.x, it.y, it.w, it.h])]);
  const hit = SP_GEO.get(key); if (hit) return hit;
  const cs = Math.max(0.1, Math.min(0.25, Math.sqrt((F.w * F.h) / 16000)));
  const nx = Math.max(2, Math.ceil(F.w / cs - 1e-9)), ny = Math.max(2, Math.ceil(F.h / cs - 1e-9));
  const g = new Uint8Array(nx * ny), ht = Math.max(WALL_T.sekat / 2, cs * 0.55);   // 0 ruang · 1 sekat · 2 sekat gantung · 3 bukaan LAR
  const X = i => F.x + (i + 0.5) * cs, Y = j => F.y + (j + 0.5) * cs;
  const segs = joinEnds(fl.walls, F).map(s => { const len = Math.hypot(s.x2 - s.x1, s.y2 - s.y1), ops = openingsOn({ ...s, ext: false }, fl); return { ...s, len, ops, pieces: solidPieces(len, ops) }; }).filter(s => s.len > 0.05);
  const mark = (x1, y1, x2, y2, v) => {
    const i0 = Math.max(0, Math.floor((Math.min(x1, x2) - ht - F.x) / cs)), i1 = Math.min(nx - 1, Math.floor((Math.max(x1, x2) + ht - F.x) / cs));
    const j0 = Math.max(0, Math.floor((Math.min(y1, y2) - ht - F.y) / cs)), j1 = Math.min(ny - 1, Math.floor((Math.max(y1, y2) + ht - F.y) / cs));
    const dx = x2 - x1, dy = y2 - y1, L2 = dx * dx + dy * dy || 1e-9;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const px = X(i), py = Y(j), t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / L2));
      if (Math.hypot(px - x1 - t * dx, py - y1 - t * dy) > ht) continue;
      const k = j * nx + i, o = g[k];
      if (v === 1 || o === 0 || (v === 2 && o === 3)) g[k] = v;
    }
  };
  segs.forEach(s => {
    const ux = (s.x2 - s.x1) / s.len, uy = (s.y2 - s.y1) / s.len, P = t => [s.x1 + ux * t, s.y1 + uy * t];
    s.pieces.forEach(([a, b]) => mark(...P(a), ...P(b), s.jenis === 'gantung' ? 2 : 1));
    s.ops.forEach(o => mark(...P(o.a), ...P(o.b), o.it.t === 'pintu' ? 1 : 3));   // pintu orang dianggap tertutup
  });
  const reg = new Int32Array(nx * ny).fill(-1), regions = [], queue = new Int32Array(nx * ny);
  for (let k0 = 0; k0 < nx * ny; k0++) {
    if (g[k0] || reg[k0] !== -1) continue;
    let qh = 0, qt = 0; queue[qt++] = k0; reg[k0] = -3;
    while (qh < qt) {
      const k = queue[qh++], i = k % nx, j = (k - i) / nx;
      for (const kk of [i > 0 ? k - 1 : -1, i < nx - 1 ? k + 1 : -1, j > 0 ? k - nx : -1, j < ny - 1 ? k + nx : -1]) {
        if (kk >= 0 && !g[kk] && reg[kk] === -1) { reg[kk] = -3; queue[qt++] = kk; }
      }
    }
    const cells = Array.from(queue.subarray(0, qt)), id = cells.length * cs * cs >= 0.2 ? regions.length : -2;
    cells.forEach(k => { reg[k] = id; });
    if (id >= 0) regions.push({ id, cells, area: cells.length * cs * cs });
  }
  regions.forEach(r => {
    let i0 = nx, i1 = 0, j0 = ny, j1 = 0, per = 0, sx = 0, sy = 0;
    r.cells.forEach(k => {
      const i = k % nx, j = (k - i) / nx;
      i0 = Math.min(i0, i); i1 = Math.max(i1, i); j0 = Math.min(j0, j); j1 = Math.max(j1, j); sx += X(i); sy += Y(j);
      if (i === 0 || reg[k - 1] !== r.id) per++; if (i === nx - 1 || reg[k + 1] !== r.id) per++;
      if (j === 0 || reg[k - nx] !== r.id) per++; if (j === ny - 1 || reg[k + nx] !== r.id) per++;
    });
    const n = r.cells.length;
    let cx = sx / n, cy = sy / n;
    const ci = lim(Math.floor((cx - F.x) / cs), 0, nx - 1), cj = lim(Math.floor((cy - F.y) / cs), 0, ny - 1);
    if (reg[cj * nx + ci] !== r.id) {   // bentuk L: pakai sel ruang yang paling dekat ke titik berat
      const k = r.cells.reduce((b, kk) => { const d = (X(kk % nx) - cx) ** 2 + (Y(Math.floor(kk / nx)) - cy) ** 2; return d < b.d ? { k: kk, d } : b; }, { k: r.cells[0], d: Infinity }).k;
      cx = X(k % nx); cy = Y(Math.floor(k / nx));
    }
    Object.assign(r, { perim: per * cs, rect: n === (i1 - i0 + 1) * (j1 - j0 + 1), cx, cy, box: { x: F.x + i0 * cs, y: F.y + j0 * cs, w: (i1 - i0 + 1) * cs, h: (j1 - j0 + 1) * cs } });
  });
  const regAt = (x, y) => { const i = Math.floor((x - F.x) / cs), j = Math.floor((y - F.y) / cs); return i >= 0 && j >= 0 && i < nx && j < ny ? reg[j * nx + i] : -1; };
  const regNear = (x, y) => { for (const [a, b] of SP_OFFS) { const v = regAt(x + a * cs, y + b * cs); if (v >= 0) return v; } return -1; };
  // pintu antar ruang: LAR pintu / jendela, dan celah di bawah sekat gantung (dipecah per ≤ 1 m)
  const ports = [], larSides = new Map();
  segs.forEach(s => {
    const ux = (s.x2 - s.x1) / s.len, uy = (s.y2 - s.y1) / s.len, nX = -uy, nY = ux, off = ht + cs * 1.2;
    const sides = (x, y) => [regNear(x + nX * off, y + nY * off), regNear(x - nX * off, y - nY * off)];
    s.ops.forEach(o => {
      if (!isLar(o.it.t)) return;
      const t = (o.a + o.b) / 2, x = s.x1 + ux * t, y = s.y1 + uy * t, [ra, rb] = sides(x, y);
      larSides.set(o.it.id, [ra, rb]);
      if (ra >= 0 && rb >= 0 && ra !== rb) ports.push({ a: ra, b: rb, x, y, nx: -nX, ny: -nY, len: o.b - o.a, kind: o.it.t, id: o.it.id });
    });
    if (s.jenis !== 'gantung') return;
    const step = cs / 2;
    s.pieces.forEach(([a, b]) => {
      let run = null;
      const flush = () => {
        if (run && run.t1 - run.t0 > 0.1) {
          const L = run.t1 - run.t0, k = Math.ceil(L);
          for (let q = 0; q < k; q++) { const t = run.t0 + (L * (q + 0.5)) / k; ports.push({ a: run.ra, b: run.rb, x: s.x1 + ux * t, y: s.y1 + uy * t, nx: -nX, ny: -nY, len: L / k, kind: 'gantung', wall: s.id }); }
        }
        run = null;
      };
      for (let t = a + step / 2; t < b; t += step) {
        const [ra, rb] = sides(s.x1 + ux * t, s.y1 + uy * t);
        if (ra < 0 || rb < 0 || ra === rb) { flush(); continue; }
        if (run && run.ra === ra && run.rb === rb) run.t1 = t + step / 2; else { flush(); run = { ra, rb, t0: t - step / 2, t1: t + step / 2 }; }
      }
      flush();
    });
  });
  const nb = regions.map(() => new Set());
  ports.forEach(p => { nb[p.a].add(p.b); nb[p.b].add(p.a); });
  const res = { F, cs, nx, ny, g, reg, regions, ports, larSides, nb, regAt, regNear, X, Y };
  SP_GEO.set(key, res); if (SP_GEO.size > 32) SP_GEO.delete(SP_GEO.keys().next().value);
  return res;
}
// Ruang satu lantai + jenisnya (dari zona yang menutupinya), nama, dan jarak (jumlah pintu) ke ruang void.
export function spaces(m, fl) {
  const F = floorRect(m, fl), geo = spaceGeom(m, fl, F), { nx, ny, cs, reg, regions } = geo, n = regions.length;
  const cov = regions.map(() => ({ void: 0, inap: 0, audio: 0, jalur: 0 })), claimed = new Uint8Array(nx * ny);
  SP_PRIO.forEach(t => fl.items.filter(it => it.t === t).forEach(z => {
    const i0 = Math.max(0, Math.ceil((z.x - F.x) / cs - 0.5)), i1 = Math.min(nx - 1, Math.floor((z.x + z.w - F.x) / cs - 0.5));
    const j0 = Math.max(0, Math.ceil((z.y - F.y) / cs - 0.5)), j1 = Math.min(ny - 1, Math.floor((z.y + z.h - F.y) / cs - 0.5));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const k = j * nx + i; if (claimed[k]) continue; claimed[k] = 1; if (reg[k] >= 0) cov[reg[k]][t]++; }
  }));
  const type = regions.map((r, i) => { const c = cov[i], N = r.cells.length; return c.void >= 0.3 * N ? 'void' : c.inap >= 0.3 * N ? 'inap' : SP_PRIO.reduce((a, t) => (c[t] > (c[a] || 0) ? t : a), 'lain'); });
  const isVoid = regions.map((r, i) => type[i] === 'void');
  fl.items.filter(it => it.t === 'void').forEach(z => { const c = center(z), k = geo.regAt(c.x, c.y) >= 0 ? geo.regAt(c.x, c.y) : geo.regNear(c.x, c.y); if (k >= 0) isVoid[k] = true; });
  const name = new Array(n), byT = {};
  regions.slice().sort((a, b) => a.cy - b.cy || a.cx - b.cx).forEach(r => { const t = isVoid[r.id] ? 'void' : type[r.id]; (byT[t] = byT[t] || []).push(r.id); });
  Object.entries(byT).forEach(([t, ids]) => ids.forEach((id, q) => { name[id] = SP_NAMA[t] + (ids.length > 1 ? ` ${q + 1}` : ''); }));
  const hop = new Array(n).fill(Infinity), q = [];
  isVoid.forEach((v, i) => { if (v) { hop[i] = 0; q.push(i); } });
  while (q.length) { const r = q.shift(); geo.nb[r].forEach(o => { if (hop[o] > hop[r] + 1) { hop[o] = hop[r] + 1; q.push(o); } }); }
  return { ...geo, type, isVoid, name, hop, deg: geo.nb.map(s => s.size) };
}

// ---------- ruang inap: zona dibagi sekat ----------
// Sekat lurus (penuh maupun gantung) yang memotong zona inap dari tepi ke tepi membaginya menjadi ruang-ruang baru.
const axisLine = w => (Math.abs(w.y1 - w.y2) < 0.01 ? { o: 'h', c: (w.y1 + w.y2) / 2, a: Math.min(w.x1, w.x2), b: Math.max(w.x1, w.x2), w }
  : Math.abs(w.x1 - w.x2) < 0.01 ? { o: 'v', c: (w.x1 + w.x2) / 2, a: Math.min(w.y1, w.y2), b: Math.max(w.y1, w.y2), w } : null);
export function splitZone(z, walls) {
  const lines = walls.map(axisLine).filter(Boolean), TOL = 0.2, MIN = 0.3, out = [], stack = [{ x: z.x, y: z.y, w: z.w, h: z.h }];
  for (let guard = 0; stack.length && guard < 400; guard++) {
    const r = stack.pop();
    const cut = lines.find(l => (l.o === 'h'
      ? l.c > r.y + MIN && l.c < r.y + r.h - MIN && l.a <= r.x + TOL && l.b >= r.x + r.w - TOL
      : l.c > r.x + MIN && l.c < r.x + r.w - MIN && l.a <= r.y + TOL && l.b >= r.y + r.h - TOL));
    if (!cut) { out.push(r); continue; }
    if (cut.o === 'h') stack.push({ x: r.x, y: r.y, w: r.w, h: r2(cut.c - r.y) }, { x: r.x, y: r2(cut.c), w: r.w, h: r2(r.y + r.h - cut.c) });
    else stack.push({ x: r.x, y: r.y, w: r2(cut.c - r.x), h: r.h }, { x: r2(cut.c), y: r.y, w: r2(r.x + r.w - cut.c), h: r.h });
  }
  return out.concat(stack).sort((a, b) => a.y - b.y || a.x - b.x);
}

// ---------- sirip & tweeter inap ----------
// Bagian sisi ruang yang menempel dinding luar / sekat (penuh atau gantung), tanpa bukaan → interval per sisi.
export function wallSideRuns(room, segs, tol = 0.3) {
  const res = { top: [], bottom: [], left: [], right: [] };
  for (const s of segs) {
    if (!(s.len > 0.05)) continue;
    const hz = Math.abs(s.y2 - s.y1) < 0.01, vt = Math.abs(s.x2 - s.x1) < 0.01; if (!hz && !vt) continue;
    const c = hz ? (s.y1 + s.y2) / 2 : (s.x1 + s.x2) / 2;
    const side = hz ? (Math.abs(c - room.y) <= tol ? 'top' : Math.abs(c - room.y - room.h) <= tol ? 'bottom' : null)
      : (Math.abs(c - room.x) <= tol ? 'left' : Math.abs(c - room.x - room.w) <= tol ? 'right' : null);
    if (!side) continue;
    const r0 = hz ? room.x : room.y, r1 = hz ? room.x + room.w : room.y + room.h, p0 = hz ? s.x1 : s.y1, dir = Math.sign(hz ? s.x2 - s.x1 : s.y2 - s.y1) || 1;
    for (const [a, b] of s.pieces || [[0, s.len]]) {
      const u = p0 + dir * a, v = p0 + dir * b, lo = Math.max(r0, Math.min(u, v)), hi = Math.min(r1, Math.max(u, v));
      if (hi - lo > 0.02) res[side].push([lo, hi]);
    }
  }
  for (const k in res) {   // gabungkan interval yang menumpuk (mis. dua sekat di garis yang sama)
    const out = [];
    res[k].sort((p, q) => p[0] - q[0]).forEach(([a, b]) => { const l = out[out.length - 1]; if (l && a <= l[1] + 0.01) l[1] = Math.max(l[1], b); else out.push([a, b]); });
    res[k] = out;
  }
  return res;
}
// Panjang sisi ruang yang menempel dinding luar / sekat (penuh atau gantung), dikurangi lebar bukaan di sisi itu.
export function wallSides(room, segs, tol = 0.3) {
  const runs = wallSideRuns(room, segs, tol), sum = l => l.reduce((s, [a, b]) => s + b - a, 0);
  return { top: sum(runs.top), bottom: sum(runs.bottom), left: sum(runs.left), right: sum(runs.right) };
}
// Papan sirip satu ruang (meter lari): garis sirip di dalam ruang tiap `gap` (sirip kotak: dua arah) + papan yang
// menempel di tiap sisi berdinding/bersekat — walaupun sirip melintang ke arah lain.
export function siripDetail(room, o, segs) {
  const kotak = room.st === 'kotak', g = room.gap || (kotak ? RULES.siripKotak : RULES.siripJarak);
  const inner = len => Math.max(0, Math.ceil(len / g - 1e-6) - 1);
  const lines = kotak ? inner(room.h) * room.w + inner(room.w) * room.h : o === 'x' ? inner(room.h) * room.w : inner(room.w) * room.h;
  const sides = segs ? wallSides(room, segs) : { top: 0, bottom: 0, left: 0, right: 0 };
  const wall = sides.top + sides.bottom + sides.left + sides.right;
  return { lines, wall, total: lines + wall, sides, gap: g };
}
export const siripLen = (room, o, segs) => siripDetail(room, o, segs).total;
// Volume kayu papan sirip (m³) dari panjang total (m) dan ukuran papan model (cm).
export const siripVolume = (m, len) => len * ((m.siripTebal || RULES.siripTebalCm) / 100) * ((m.siripLebar || RULES.siripLebarCm) / 100);

// Jumlah tweeter inap yang disarankan: baris tiap ±1 m sejajar sirip, pola 2-1-2 / 3-2-3 / 4-3-4 menurut lebar ruang.
export function twinapRekomendasi(room, o) {
  const depth = o === 'x' ? room.h : room.w, lebar = o === 'x' ? room.w : room.h;
  const rows = Math.max(1, Math.floor((depth - 0.3) / RULES.twinapBaris)), [a, b] = RULES.twinapPola(lebar);
  let n = 0; for (let i = 0; i < rows; i++) n += i % 2 ? b : a;
  return n;
}

// Posisi tweeter inap pola standar satu ruang (dipakai generator, tombol "Isi tweeter", dan link desain):
// baris sejajar sirip tiap ±1 m mulai 0,7 m dari dinding belakang (sisi seberang pintu masuk), pola 2-1-2 / 3-2-3 / 4-3-4.
export function twinapPattern(room, o, side) {
  const depth = o === 'x' ? room.h : room.w, lebar = o === 'x' ? room.w : room.h, [a, b] = RULES.twinapPola(lebar), pts = [];
  for (let row = 0, d = 0.7; d < depth - 0.6; row++, d += RULES.twinapBaris) {
    const cnt = row % 2 ? b : a;
    for (let q = 0; q < cnt; q++) {
      const along = (lebar * (q + 0.5)) / cnt;
      pts.push(o === 'x'
        ? { x: room.x + along, y: side === 'bottom' ? room.y + d : room.y + room.h - d }
        : { x: side === 'right' ? room.x + d : room.x + room.w - d, y: room.y + along });
    }
  }
  return pts;
}
// Pola standar untuk seluruh ruang hasil pembagian satu zona inap.
export function zonePattern(der, zid) {
  return (der.zoneRooms.get(zid) || []).flatMap(r => {
    const o = der.orient.get(r.id), e = der.entr.get(r.id)[0];
    return twinapPattern(r, o, e ? e.side : o === 'x' ? 'top' : 'left');
  });
}

// Semua turunan satu lantai sekaligus (dihitung sekali per render).
export function derive(m, fl) {
  const F = floorRect(m, fl);
  const segs = wallSegs(m, fl).map(s => {
    const len = Math.hypot(s.x2 - s.x1, s.y2 - s.y1), ops = openingsOn(s, fl);
    return { ...s, len, ops, pieces: solidPieces(len, ops) };
  });
  const onWall = new Set(segs.flatMap(s => s.ops.map(o => o.it.id)));
  const sp = spaces(m, fl), regOf = p => { const k = sp.regAt(p.x, p.y); return k >= 0 ? k : sp.regNear(p.x, p.y); };
  const voids = fl.items.filter(it => it.t === 'void'), lmbs = fl.items.filter(it => it.t === 'lmb');
  const lars = fl.items.filter(it => isLar(it.t)), tariks = fl.items.filter(it => it.t === 'twtarik');
  const vC = voids.map(center), toVoid = p => (vC.length ? Math.min(...vC.map(v => dist(p, v))) : 0);
  const hopOf = r => (r >= 0 && Number.isFinite(sp.hop[r]) ? sp.hop[r] : 999);

  // fungsi LAR: menghubungkan ruang void → LAR void; ruang inap / ruang buntu → LAR inap; selain itu → LAR jalur
  const larAuto = new Map(), larType = new Map();
  lars.forEach(it => {
    const rs = (sp.larSides.get(it.id) || []).filter(r => r >= 0);
    const auto = rs.some(r => sp.isVoid[r]) ? 'void' : rs.some(r => sp.type[r] === 'inap' || (sp.type[r] === 'lain' && sp.deg[r] <= 1)) ? 'inap' : 'jalur';
    larAuto.set(it.id, auto); larType.set(it.id, LAR_FN.includes(it.lt) ? it.lt : auto);
  });
  // jalan keluar tiap ruang: pintu (LAR / celah sekat gantung) ke ruang yang paling dekat ke void; bila setara →
  // LAR dulu, lalu yang meneruskan arah ruang di depannya (lurus), fungsi LAR (void > jalur > inap), paling dekat ke void
  const cardinal = (a, b) => (Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) ? (b.x >= a.x ? 'right' : 'left') : (b.y >= a.y ? 'bottom' : 'top'));
  const PREF = { void: 0, jalur: 1, inap: 2 };
  const doors = sp.regions.map(() => []);
  sp.ports.forEach(p => [[p.a, p.b], [p.b, p.a]].forEach(([r, o]) => {
    const L = doors[r], e = p.kind === 'gantung' && L.find(q => q.kind === 'gantung' && q.to === o);
    if (e) { const s = e.len + p.len; e.x = (e.x * e.len + p.x * p.len) / s; e.y = (e.y * e.len + p.y * p.len) / s; e.len = s; return; }
    L.push({ kind: p.kind === 'gantung' ? 'gantung' : 'lar', to: o, x: p.x, y: p.y, len: p.len, id: p.id || null });
  }));
  const exits = new Map(), exitDir = new Map();
  sp.regions.map(r => r.id).sort((a, b) => hopOf(a) - hopOf(b)).forEach(id => {
    const c = { x: sp.regions[id].cx, y: sp.regions[id].cy };
    const key = e => [hopOf(e.to), e.kind === 'lar' ? 0 : 1, exitDir.get(e.to) === cardinal(c, e) ? 0 : 1, e.id ? PREF[larType.get(e.id)] ?? 1 : 1, toVoid(e), -e.len];
    const arr = doors[id].slice().sort((a, b) => { const ka = key(a), kb = key(b); for (let q = 0; q < ka.length; q++) if (ka[q] !== kb[q]) return ka[q] - kb[q]; return 0; });
    exits.set(id, arr); if (arr[0]) exitDir.set(id, cardinal(c, arr[0]));
  });

  // ruang inap (zona dibagi sekat); jalan masuk = jalan keluar ruang tempatnya berada ke arah void
  const zones = fl.items.filter(it => it.t === 'inap'), zoneRooms = new Map(), rooms = [], jrooms = [];
  const addZone = (z, into) => {
    const parts = splitZone(z, fl.walls);
    const rs = parts.map((p, k) => ({ ...p, id: parts.length > 1 ? `${z.id}~${k}` : z.id, zid: z.id, k, n: parts.length, gap: z.gap, o: z.o, st: z.st }));
    zoneRooms.set(z.id, rs); into.push(...rs);
  };
  zones.forEach(z => addZone(z, rooms));
  // ruang jalur bersirip (pemilik: jalur paling lama ditempati — beri sirip & tweeter juga; ikut dihitung sarang)
  fl.items.filter(it => it.t === 'jalur' && (it.gap || it.st || it.o)).forEach(z => addZone(z, jrooms));
  const roomOf = p => rooms.find(r => inRect(p, r)) || null;
  const anyRoomOf = p => roomOf(p) || jrooms.find(r => inRect(p, r)) || null;
  const sideOf = (r, p) => {
    const ox = Math.max(0, r.x - p.x, p.x - r.x - r.w), oy = Math.max(0, r.y - p.y, p.y - r.y - r.h);
    return [['top', Math.abs(p.y - r.y) + ox], ['bottom', Math.abs(p.y - r.y - r.h) + ox], ['left', Math.abs(p.x - r.x) + oy], ['right', Math.abs(p.x - r.x - r.w) + oy]].reduce((a, b) => (b[1] < a[1] ? b : a))[0];
  };
  const entr = new Map(rooms.concat(jrooms).map(r => { const R = regOf(center(r)); return [r.id, R >= 0 ? (exits.get(R) || []).map(e => ({ ...e, side: sideOf(r, e), hop: hopOf(e.to) })) : []]; }));
  const orient = new Map(rooms.concat(jrooms).map(r => {
    if (r.o === 'x' || r.o === 'y') return [r.id, r.o];
    const e = entr.get(r.id)[0];
    // sirip melintang arah terbang: pintu di sisi atas/bawah → garis sirip sejajar X
    return [r.id, e ? (e.side === 'top' || e.side === 'bottom' ? 'x' : 'y') : (r.h >= r.w ? 'x' : 'y')];
  }));
  const dirs = new Map(), autoDir = new Map(), targets = new Map(), blocked = new Set();
  const toward = c => { const n = nearest(c, lars.concat(voids)); return n ? angleTo(c, center(n.it)) : 270; };
  // arah keluar dari suatu titik: ke pintu terbaik ruangnya (lewat LAR), atau ke void bila di ruang void
  const exitAngle = c => {
    const R = regOf(c);
    if (R >= 0 && sp.isVoid[R] && vC.length) return angleTo(c, vC.reduce((a, b) => (dist(c, a) <= dist(c, b) ? a : b)));
    const e = R >= 0 ? exits.get(R)?.[0] : null;
    return e ? angleTo(c, e) : toward(c);
  };

  // tweeter inap: seluruhnya menghadap jalan masuk ruangnya (ke arah LAR void) — lurus 4 arah, tidak serong
  for (const it of fl.items) {
    if (it.t !== 'twinap') continue;
    const c = center(it), room = anyRoomOf(c), e = room ? entr.get(room.id)[0] : null;
    const d = e ? SIDE_DIR[e.side] : snap90(exitAngle(c));
    autoDir.set(it.id, d); dirs.set(it.id, Number.isFinite(it.dir) ? snap90(it.dir) : d);
  }
  // tweeter tarik: menghadap tweeter tarik di depannya (inap → LAR inap → jalur → LAR void → LMB). Garis rantai tidak
  // boleh menembus sekat (boleh lewat LAR / bawah sekat gantung); tujuan bisa ditarik manual (it.to).
  const solid = segs.filter(s => !s.ext && s.jenis !== 'gantung' && s.len > 0.05).flatMap(s => {
    const ux = (s.x2 - s.x1) / s.len, uy = (s.y2 - s.y1) / s.len;
    return s.pieces.map(([u, v]) => [{ x: s.x1 + ux * u, y: s.y1 + uy * u }, { x: s.x1 + ux * v, y: s.y1 + uy * v }]);
  });
  const clear = (a, b) => !solid.some(([p, q]) => segCross(a, b, p, q));
  const roles = new Map(tariks.map(it => {
    if (it.role && it.role in ROLE_ORDER) return [it.id, it.role];
    const c = center(it);
    if (lmbs.some(z => dist(center(z), c) <= 1.0)) return [it.id, 'lmb'];
    if (voids.some(z => distToRect(c, z) <= 0.45)) return [it.id, 'void'];
    const L = lars.map(z => ({ z, d: dist(center(z), c) })).filter(o => o.d <= 1.0).sort((a, b) => a.d - b.d)[0];
    if (L) { const t = larType.get(L.z.id); return [it.id, t === 'void' ? 'void' : t === 'jalur' ? 'jalur' : 'lar']; }
    const R = regOf(c);
    return [it.id, roomOf(c) || (R >= 0 && sp.type[R] === 'inap') ? 'inap' : 'jalur'];
  }));
  const ordOf = z => ROLE_ORDER[roles.get(z.id)];
  const prevOf = z0 => { const o0 = ordOf(z0), p = tariks.filter(z => ordOf(z) === o0 - 1); return p.length ? p : tariks.filter(z => ordOf(z) < o0); };
  const gDist = new Map(tariks.map(z => { const n0 = nearest(center(z), prevOf(z)); return [z.id, n0 ? n0.d : Infinity]; }));
  for (const it of tariks) {
    const c = center(it), role = roles.get(it.id), ord = ROLE_ORDER[role], man = it.to ? tariks.find(z => z.id === it.to && z !== it) : null;
    let d = null, target = null;
    if (man) { target = man; d = angleTo(c, center(man)); if (!clear(c, center(man))) blocked.add(it.id); }
    else if (role === 'lmb') {
      const l = nearest(c, lmbs);
      if (l) {
        const v = voids.reduce((b, z) => { const dd = distToRect(center(l.it), z); return !b || dd < b.d ? { it: z, d: dd } : b; }, null);
        d = v ? (Math.round(angleTo(center(v.it), center(l.it)) / 90) * 90) % 360 : outwardDir(center(l.it), F);
      } else d = 270;
    } else if (role === 'void') {
      const up = tariks.filter(z => ordOf(z) < ord).map(z => ({ z, d: dist(c, center(z)) })).sort((a, b) => a.d - b.d).find(o => clear(c, center(o.z)));
      if (up) { target = up.z; d = angleTo(c, center(up.z)); }
      else { const v = voids.reduce((b, z) => { const dd = distToRect(c, z); return !b || dd < b.d ? { it: z, d: dd } : b; }, null); d = v ? angleTo(c, center(v.it)) : exitAngle(c); }
    } else {
      const room = role === 'inap' ? roomOf(c) : null, myG = gDist.get(it.id);
      const same = tariks.filter(z => z !== it && ordOf(z) === ord && (!room || roomOf(center(z)) === room) && gDist.get(z.id) < myG - 0.3);
      const cands = prevOf(it).concat(same).map(z => ({ z, d: dist(c, center(z)) })).sort((a, b) => a.d - b.d);
      const ok = cands.find(o => clear(c, center(o.z)));
      if (ok) { target = ok.z; d = angleTo(c, center(ok.z)); }
      else { if (cands.length) blocked.add(it.id); d = exitAngle(c); }   // terhalang sekat → hadapkan ke LAR jalan keluarnya
    }
    targets.set(it.id, target); autoDir.set(it.id, d); dirs.set(it.id, Number.isFinite(it.dir) ? it.dir : d);
  }
  return { F, segs, onWall, sp, zones, rooms, jrooms, zoneRooms, entr, exits, orient, roles, dirs, autoDir, targets, blocked, larType, larAuto, roomOf, clear };
}

function outwardDir(p, F) {
  return [[p.y - F.y, 270], [F.y + F.h - p.y, 90], [p.x - F.x, 180], [F.x + F.w - p.x, 0]].reduce((a, b) => (a[0] <= b[0] ? a : b))[1];
}

// Papan sirip efektif: ruang inap + ruang jalur bersirip, dikurangi bagian yang menumpuk dengan zona lain.
export function siripEfektif(fl, der) {
  const blk = t => fl.items.filter(it => t.includes(it.t));
  const sum = (rooms, blockers) => rooms.reduce((s, r) => {
    const A = r.w * r.h || 1, cut = Math.min(A, blockers.reduce((q, b) => q + ovArea(r, b), 0));
    return s + siripDetail(r, der.orient.get(r.id), der.segs).total * (1 - cut / A);
  }, 0);
  return sum(der.rooms, blk(['void', 'jalur', 'audio'])) + sum(der.jrooms || [], blk(['void', 'audio', 'inap']));
}

// Kolom (grid modul, sejajar titik 0 gedung) & balok (setengah modul) di dalam batas lantai F.
export function structure(m, F = { x: 0, y: 0, w: m.w, h: m.h }) {
  const k = m.kolom || RULES.kolom, h2 = k / 2;
  const xs = new Set([r2(F.x), r2(F.x + F.w)]), ys = new Set([r2(F.y), r2(F.y + F.h)]), bx = [], by = [];
  for (let x = Math.ceil((F.x - 1e-6) / k) * k; x <= F.x + F.w + 1e-6; x += k) xs.add(r2(x));
  for (let y = Math.ceil((F.y - 1e-6) / k) * k; y <= F.y + F.h + 1e-6; y += k) ys.add(r2(y));
  for (let x = Math.ceil((F.x + 0.05) / h2) * h2; x < F.x + F.w - 0.05; x += h2) bx.push(r2(x));
  for (let y = Math.ceil((F.y + 0.05) / h2) * h2; y < F.y + F.h - 0.05; y += h2) by.push(r2(y));
  const sort = s => [...s].sort((a, b) => a - b);
  return { xs: sort(xs), ys: sort(ys), bx, by, F };
}
