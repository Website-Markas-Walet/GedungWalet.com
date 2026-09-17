// Simulasi cahaya ("Cek lux"). RBW tanpa lampu: satu-satunya cahaya = matahari yang masuk lewat LMB. Terang LMB
// bergantung posisi matahari (jam, bulan, lintang), arah hadap LMB (kompas), dan kondisi langit — LMB menghadap barat
// kena sinar langsung sore hari. Cahaya diteruskan LMB → ruang void / menara → LAR / bawah sekat gantung → ruang jalur
// (remang) → ruang inap (gelap), dan antar lantai lewat lubang void; makin ke dalam & ke bawah makin gelap. Jalur cahaya
// dari tiap ruang ke ruang yang lebih terang sampai LMB = arah yang dicari anakan walet saat belajar terbang keluar.
// Model: cahaya langsung tiap bukaan (sumber bidang Lambert, 3D sederhana) + pantulan rata per ruang (fluks terbagi),
// dihitung berulang sampai stabil. Perkiraan orde besaran — bukan pengganti lux meter.
import { RULES, SIM_DEFAULT } from './planner-data.js';
import { floorHt, floorRect, spaces, levels } from './planner-geom.js';

const RHO = { lantai: 0.2, dinding: 0.3, dindingVoid: 0.2, plafon: 0.25, plafonInap: 0.08 };   // pantulan permukaan (asumsi)
const TAU_LMB = 0.6;                 // kusen, kawat & bayangan LMB
const GANTUNG = 0.7;                 // sekat gantung: dari plafon sampai 50 cm di bawah sirip (sirip 20 cm)
const UKUR = 0.3;                    // titik ukur ±30 cm di bawah plafon (area sirip)
const RAD = Math.PI / 180;
// skala warna log10(lux): gelap biru tua → biru (1 lux) → hijau → kuning → jingga (≥ 1000 lux)
export const LUX_STOPS = [[-2, [10, 15, 36]], [-1, [27, 42, 107]], [0, [44, 127, 184]], [0.5, [65, 182, 196]], [1, [127, 205, 187]], [1.5, [199, 233, 180]], [2, [254, 227, 145]], [3, [254, 153, 41]]];
export function luxColor(E) {
  const v = Math.log10(Math.max(0.01, E));
  for (let i = 1; i < LUX_STOPS.length; i++) {
    const [a, ca] = LUX_STOPS[i - 1], [b, cb] = LUX_STOPS[i];
    if (v <= b) { const t = Math.max(0, (v - a) / (b - a)); return ca.map((c, k) => Math.round(c + (cb[k] - c) * t)); }
  }
  return LUX_STOPS[LUX_STOPS.length - 1][1];
}
export const kategori = E => (E < RULES.luxInap ? 'gelap' : E < RULES.luxRemang ? 'remang' : 'terang');
export const fmtLux = E => (E < 0.01 ? '< 0,01' : E < 10 ? E.toFixed(E < 1 ? 2 : 1) : String(Math.round(E))).replace('.', ',');
export const luxTxt = E => (E < 0.01 ? '< 0,01 lux' : `±${fmtLux(E)} lux`);

// ---------- matahari & langit ----------
export const simOf = m => ({ ...SIM_DEFAULT, ...(m.sim || {}) });
// Posisi matahari (waktu matahari setempat): azimut dari utara searah jarum jam & ketinggian, dalam derajat.
export function sunPos(sim) {
  const lat = (sim.lintang ?? -6) * RAD, mon = +sim.bulan || new Date().getMonth() + 1;
  const n = Math.round((mon - 1) * 30.4 + 15), dec = 23.44 * RAD * Math.sin((2 * Math.PI * (284 + n)) / 365);
  const H = 15 * ((sim.jam ?? 12) - 12) * RAD;
  const sinEl = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(H), el = Math.asin(Math.max(-1, Math.min(1, sinEl)));
  const den = Math.cos(el) * Math.cos(lat);
  let az = den > 1e-6 ? Math.acos(Math.max(-1, Math.min(1, (Math.sin(dec) - sinEl * Math.sin(lat)) / den))) / RAD : 0;
  if (H > 0) az = 360 - az;
  return { az, el: el / RAD };
}
// Terang langit luar: sinar langsung (tegak lurus matahari) & sebaran langit di bidang datar, lux.
const LANGIT_K = { cerah: [1, 1], berawan: [0.35, 1.4], mendung: [0, 0.85] };
export function skyLux(sim, sun) {
  const s = Math.sin(Math.max(0, sun.el) * RAD);
  if (s <= 0.01) return { dn: 0, dh: 0, gh: 0 };
  const [kd, kf] = LANGIT_K[sim.langit] || LANGIT_K.berawan, dn = kd * 100000 * Math.exp(-0.18 / s), dh = kf * 15000 * Math.pow(s, 0.6);
  return { dn, dh, gh: dh + dn * s };
}
// Arah kompas bukaan dari normal keluarnya di denah (depan = ke atas denah = arah `hadap`).
export const facadeAz = (ox, oy, hadap) => (((hadap + Math.atan2(ox, -oy) / RAD) % 360) + 360) % 360;
export const arahNama = az => ['utara', 'timur laut', 'timur', 'tenggara', 'selatan', 'barat daya', 'barat', 'barat laut'][Math.round((((az % 360) + 360) % 360) / 45) % 8];

// faktor pandang dua persegi sejajar berhadapan a×b berjarak c (Hottel)
function ffPar(a, b, c) {
  const X = a / c, Y = b / c, X2 = X * X, Y2 = Y * Y;
  const t = Math.log(Math.sqrt(((1 + X2) * (1 + Y2)) / (1 + X2 + Y2))) + X * Math.sqrt(1 + Y2) * Math.atan(X / Math.sqrt(1 + Y2))
    + Y * Math.sqrt(1 + X2) * Math.atan(Y / Math.sqrt(1 + X2)) - X * Math.atan(X) - Y * Math.atan(Y);
  return Math.max(0, Math.min(1, (2 / (Math.PI * X * Y)) * t));
}
const ovRect = (a, b) => {
  if (!a || !b) return null;
  const x0 = Math.max(a.x, b.x), y0 = Math.max(a.y, b.y), x1 = Math.min(a.x + a.w, b.x + b.w), y1 = Math.min(a.y + a.h, b.y + b.h);
  return x1 - x0 > 0.01 && y1 - y0 > 0.01 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
};

// ---------- satu lantai: ruang berdasarkan sekat (planner-geom) + bukaan antar ruang + LMB ----------
function prepFloor(m, fl, fi) {
  const sp = spaces(m, fl), F = sp.F, H = floorHt(m, fl), mn = !!fl.menara;   // lantai menara = bagian atas ruang void
  const regions = sp.regions.map(r => ({ fi, id: r.id, cells: r.cells, area: r.area, perim: r.perim, rect: r.rect, cx: r.cx, cy: r.cy, box: r.box, type: mn || sp.isVoid[r.id] ? 'void' : sp.type[r.id], name: mn ? 'Menara' : sp.name[r.id], fixed: [] }));
  const ports = sp.ports.map(p => {   // LAR pintu 0–2 m, LAR jendela 1 m di bagian atas, celah di bawah sekat gantung
    const h = p.kind === 'larj' ? Math.min(1, H - 0.2) : p.kind === 'lar' ? Math.min(2, H) : H - GANTUNG;
    return h < 0.2 ? null : { a: p.a, b: p.b, x: p.x, y: p.y, z: p.kind === 'larj' ? H - 0.2 - h / 2 : h / 2, nx: p.nx, ny: p.ny, A: p.len * h };
  }).filter(Boolean);
  const lmbs = fl.items.filter(it => it.t === 'lmb').map(it => {   // LMB di dinding luar lantai/menara ini
    const x = it.x + it.w / 2, y = it.y + it.h / 2, tt = (it.tcm || 50) / 100;
    const e = [[y - F.y, 0, 1], [F.y + F.h - y, 0, -1], [x - F.x, 1, 0], [F.x + F.w - x, -1, 0]].reduce((p, q) => (q[0] < p[0] ? q : p));
    return { x, y, tt, ext: e[0] <= 0.4, nx: e[1], ny: e[2], wx: x - e[1] * e[0], wy: y - e[2] * e[0], A: Math.max(it.w, it.h) * tt };
  });
  return { fi, F, H, cs: sp.cs, nx: sp.nx, ny: sp.ny, g: sp.g, reg: sp.reg, regions, ports, lmbs, regNear: sp.regNear, X: sp.X, Y: sp.Y };
}
const majority = (f, R) => {
  if (!R) return -1;
  const cnt = new Map();
  for (let y = R.y + f.cs / 2; y < R.y + R.h; y += f.cs) for (let x = R.x + f.cs / 2; x < R.x + R.w; x += f.cs) {
    const i = Math.floor((x - f.F.x) / f.cs), j = Math.floor((y - f.F.y) / f.cs);
    if (i < 0 || j < 0 || i >= f.nx || j >= f.ny) continue;
    const r = f.reg[j * f.nx + i]; if (r >= 0) cnt.set(r, (cnt.get(r) || 0) + 1);
  }
  let best = -1, bn = 0; cnt.forEach((v, k) => { if (v > bn) { bn = v; best = k; } });
  return best;
};

// ---------- seluruh gedung (lantai + menara) ----------
let cache = { sig: '', res: null };
export function simulate(m) {
  const sim = simOf(m), sun = sunPos(sim), sky = skyLux(sim, sun), LV = levels(m);
  const sig = JSON.stringify([m.w, m.h, m.floorH, sim, m.floors, m.menara || null]);
  if (cache.sig === sig) return cache.res;
  const n = LV.length, FL = LV.map((fl, fi) => prepFloor(m, fl, fi)), R = [];
  FL.forEach(f => f.regions.forEach(r => { r.gid = R.length; R.push(r); }));
  // setengah-bukaan berarah (keluar dari satu ruang = masuk ke ruang lain)
  const HP = [];
  const pair = (P, Q, outP, inQ, outQ, inP, A) => {
    const k = HP.length;
    HP.push({ from: P, to: Q, ...outP, A, entry: { ...inQ, A }, rev: k + 1 }, { from: Q, to: P, ...outQ, A, entry: { ...inP, A }, rev: k });
  };
  FL.forEach(f => f.ports.forEach(p => {
    const pos = [p.x, p.y, p.z], nv = [p.nx, p.ny, 0], nr = [-p.nx, -p.ny, 0];
    pair(f.regions[p.a].gid, f.regions[p.b].gid, { pos, n: nv }, { pos, n: nv }, { pos, n: nr }, { pos, n: nr }, p.A);
  }));
  // lubang void antar lantai (lantai menara terbuka seluruhnya ke ruang void di bawahnya): P di atas, Q di bawah
  for (let fi = 1; fi < n; fi++) (LV[fi].menara ? [floorRect(m, LV[fi])] : LV[fi].items.filter(it => it.t === 'void')).forEach(v => {
    const up = FL[fi], lo = FL[fi - 1], Rr = ovRect(ovRect(v, up.F), lo.F);
    if (!Rr || Rr.w * Rr.h < 0.3) return;
    const ru = majority(up, Rr), rl = majority(lo, Rr);
    if (ru < 0 || rl < 0) return;
    const c = [Rr.x + Rr.w / 2, Rr.y + Rr.h / 2];
    pair(up.regions[ru].gid, lo.regions[rl].gid, { pos: [...c, 0], n: [0, 0, -1], rect: Rr }, { pos: [...c, lo.H], n: [0, 0, -1], rect: Rr },
      { pos: [...c, lo.H], n: [0, 0, 1], rect: Rr }, { pos: [...c, 0], n: [0, 0, 1], rect: Rr }, Rr.w * Rr.h);
  });
  // sumber: LMB — sinar langsung bila matahari di depannya + sebaran langit & pantulan tanah
  let sumber = 0; const lmbInfo = [];
  FL.forEach(f => f.lmbs.forEach(l => {
    let Phi, az = null, direct = false;
    if (l.ext) {
      az = facadeAz(-l.nx, -l.ny, sim.hadap);
      const cosI = Math.cos(sun.el * RAD) * Math.cos((sun.az - az) * RAD);
      direct = cosI > 0.05 && sky.dn > 0;
      Phi = (0.5 * sky.dh + 0.5 * 0.2 * sky.gh + (cosI > 0 ? sky.dn * cosI * 0.7 : 0)) * l.A * TAU_LMB;
      const rg = f.regNear(l.wx + l.nx * (0.3 + f.cs), l.wy + l.ny * (0.3 + f.cs));
      if (rg >= 0) f.regions[rg].fixed.push({ Phi, pos: [l.wx, l.wy, f.H - 0.25 - l.tt / 2], n: [l.nx, l.ny, 0], A: l.A });
    } else {   // LMB di tengah atap (lubang mendatar): melihat seluruh langit
      Phi = sky.gh * l.A * TAU_LMB;
      const rg = f.regNear(l.x, l.y);
      if (rg >= 0) f.regions[rg].fixed.push({ Phi, pos: [l.x, l.y, f.H], n: [0, 0, -1], A: l.A });
    }
    sumber += Phi; lmbInfo.push({ fi: f.fi, x: l.x, y: l.y, az, direct, Phi });
  }));
  R.forEach(r => {
    const H = FL[r.fi].H, rc = r.type === 'inap' ? RHO.plafonInap : RHO.plafon, rw = r.type === 'void' ? RHO.dindingVoid : RHO.dinding;
    r.H = H; r.S = 2 * r.area + r.perim * H; r.rho = (RHO.lantai * r.area + rc * r.area + rw * r.perim * H) / r.S;
    r.out = []; r.inn = [];
  });
  HP.forEach((h, k) => { R[h.from].out.push(k); R[h.to].inn.push(k); });
  R.forEach(r => { r.fOpen = Math.min(0.9, r.out.reduce((s, k) => s + HP[k].A, 0) / r.S); });

  // cahaya langsung dari satu bukaan ke bukaan lain di ruang yang sama (faktor pandang); sekat menghalangi
  const visible = (r, a, b) => {
    if (r.rect) return true;
    const f = FL[r.fi], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy), st = f.cs / 2;
    for (let t = 0.25; t < L - 0.25; t += st) {
      const i = Math.floor((a[0] + (dx * t) / L - f.F.x) / f.cs), j = Math.floor((a[1] + (dy * t) / L - f.F.y) / f.cs);
      if (i < 0 || j < 0 || i >= f.nx || j >= f.ny) return false;
      const k = j * f.nx + i; if (f.reg[k] !== r.id && f.g[k] !== 3) return false;
    }
    return true;
  };
  const ff = (r, e, o) => {
    if (e.rect && o.rect) {
      const ov = ovRect(e.rect, o.rect), dz = Math.abs(e.pos[2] - o.pos[2]);
      if (ov && dz > 0.05) return ffPar(ov.w, ov.h, dz) * ((ov.w * ov.h) / e.A);
    }
    const v = [o.pos[0] - e.pos[0], o.pos[1] - e.pos[1], o.pos[2] - e.pos[2]], d2 = v[0] ** 2 + v[1] ** 2 + v[2] ** 2, d = Math.sqrt(d2);
    if (d < 1e-6) return 0;
    const ce = (e.n[0] * v[0] + e.n[1] * v[1] + e.n[2] * v[2]) / d, co = (o.n[0] * v[0] + o.n[1] * v[1] + o.n[2] * v[2]) / d;
    if (ce <= 0 || co <= 0 || !visible(r, e.pos, o.pos)) return 0;
    return Math.min(0.9, (o.A * ce * co) / (Math.PI * (d2 + o.A / 4)));
  };
  R.forEach(r => {
    r.ents = r.fixed.map(e => ({ ...e })).concat(r.inn.map(k => ({ ...HP[k].entry, port: k, Phi: 0 })));
    r.T = r.ents.map(e => {
      const row = r.out.map(k => (e.port !== undefined && HP[k].rev === e.port ? 0 : ff(r, e, HP[k])));
      const s = row.reduce((a, b) => a + b, 0);
      return s > 0.95 ? row.map(v => (v * 0.95) / s) : row;
    });
  });
  // iterasi sampai fluks tiap bukaan stabil
  const flux = new Float64Array(HP.length);
  for (let it = 0; it < 120; it++) {
    let change = 0;
    R.forEach(r => {
      r.ents.forEach(e => { if (e.port !== undefined) e.Phi = flux[e.port]; });
      const direct = new Float64Array(r.out.length); let first = 0, tot = 0;
      r.ents.forEach((e, ei) => {
        const row = r.T[ei]; let s = 0;
        row.forEach((f, oi) => { direct[oi] += e.Phi * f; s += f; });
        first += e.Phi * (1 - s); tot += e.Phi;
      });
      const diff = (r.rho * first) / (1 - r.rho * (1 - r.fOpen));
      r.Eref = diff / r.S; r.Phi = tot;
      r.out.forEach((k, oi) => { const nv = direct[oi] + r.Eref * HP[k].A; change = Math.max(change, Math.abs(nv - flux[k]) / (nv + 1e-3)); flux[k] = nv; });
    });
    if (change < 1e-4) break;
  }
  // sumber titik untuk medan lux: lubang mendatar dipecah per ≤ 1 m agar dekat lubang tidak berlebihan
  R.forEach(r => {
    r.src = r.ents.filter(e => e.Phi > 1e-6).flatMap(e => {
      if (!e.rect) return [e];
      const kx = Math.max(1, Math.ceil(e.rect.w)), ky = Math.max(1, Math.ceil(e.rect.h)), out = [];
      for (let a = 0; a < kx; a++) for (let b = 0; b < ky; b++) out.push({ Phi: e.Phi / (kx * ky), A: e.A / (kx * ky), n: e.n, pos: [e.rect.x + (e.rect.w * (a + 0.5)) / kx, e.rect.y + (e.rect.h * (b + 0.5)) / ky, e.pos[2]] });
      return out;
    });
  });
  const evalAt = (r, x, y) => {
    const p = [x, y, r.H - UKUR]; let E = r.Eref;
    for (const s of r.src) {
      const v0 = p[0] - s.pos[0], v1 = p[1] - s.pos[1], v2 = p[2] - s.pos[2], d2 = v0 * v0 + v1 * v1 + v2 * v2, d = Math.sqrt(d2) || 1e-6;
      const ce = (s.n[0] * v0 + s.n[1] * v1 + s.n[2] * v2) / d;   // sensor menghadap sumber cahaya
      if (ce <= 0 || !visible(r, s.pos, p)) continue;
      E += Math.min(s.Phi / s.A, (s.Phi * ce) / (Math.PI * (d2 + s.A / (2 * Math.PI))));
    }
    return E;
  };
  FL.forEach(f => f.regions.forEach(r => {
    const st = r.cells.length > 6000 ? 4 : r.cells.length > 1500 ? 2 : 1; let sum = 0, cnt = 0, mx = 0;
    for (let q = 0; q < r.cells.length; q += st) { const k = r.cells[q], E = evalAt(r, f.X(k % f.nx), f.Y(Math.floor(k / f.nx))); sum += E; cnt++; if (E > mx) mx = E; }
    r.lux = sum / cnt; r.luxMax = mx;
  }));

  // jalur cahaya anakan: dari tiap ruang, pintu menuju ruang ber-LMB (bila bersebelahan) atau ruang tetangga yang
  // lebih terang — diikuti sampai ruang yang menerima cahaya langsung LMB. Ruang inap yang tidak sampai = buntu.
  const exitR = r => r.fixed.length > 0;
  R.forEach(r => {
    let best = null;
    r.out.forEach(k => {
      const q = R[HP[k].to], b = best == null ? null : R[HP[best].to];
      if (exitR(q) && !exitR(r)) { if (!b || !exitR(b) || q.lux > b.lux) best = k; }
      else if (q.lux > r.lux * 1.1 && (!b || (!exitR(b) && q.lux > b.lux))) best = k;
    });
    r.next = best;
  });
  R.forEach(r => { let q = r, s = 0; while (q && !exitR(q) && q.next != null && s++ < 80) q = R[HP[q.next].to]; r.reach = !!q && exitR(q); });
  const flow = FL.map(() => []);
  R.forEach(r => {
    const f = flow[r.fi], from = [r.cx, r.cy];
    if (exitR(r)) { f.push({ kind: 'exit', at: from }); return; }
    if (r.next == null) { f.push({ kind: 'buntu', at: from, inap: r.type === 'inap' }); return; }
    const h = HP[r.next], q = R[h.to], via = [h.pos[0], h.pos[1]];
    if (h.rect) f.push({ kind: q.fi > r.fi ? 'naik' : 'turun', from, via });
    else f.push({ kind: 'step', from, via, to: [q.cx, q.cy] });
  });
  const fields = [];
  const field = fi => {
    if (fields[fi]) return fields[fi];
    const f = FL[fi], out = new Float32Array(f.nx * f.ny).fill(NaN);
    f.regions.forEach(r => r.cells.forEach(k => { out[k] = evalAt(r, f.X(k % f.nx), f.Y(Math.floor(k / f.nx))); }));
    return (fields[fi] = out);
  };
  const at = (fi, x, y) => {
    const f = FL[fi]; if (!f) return null;
    const i = Math.floor((x - f.F.x) / f.cs), j = Math.floor((y - f.F.y) / f.cs);
    if (i < 0 || j < 0 || i >= f.nx || j >= f.ny) return null;
    const rid = f.reg[j * f.nx + i]; if (rid < 0) return null;
    const r = f.regions[rid];
    return { lux: evalAt(r, x, y), region: r };
  };
  const res = { sim, sun, sky, lmbs: lmbInfo, sumber, floors: FL, regions: R, hp: HP, flow, field, at, heat: [] };
  cache = { sig, res };
  return res;
}

// Gambar medan lux satu lantai (1 piksel = 1 sel grid) → blob: URL untuk <image> di denah.
export function heatURL(res, fi) {
  if (res.heat[fi]) return res.heat[fi];
  const f = res.floors[fi], lux = res.field(fi), cv = document.createElement('canvas');
  cv.width = f.nx; cv.height = f.ny;
  const c = cv.getContext('2d'), img = c.createImageData(f.nx, f.ny);
  for (let k = 0; k < lux.length; k++) {
    if (!(lux[k] >= 0)) continue;
    const [r, g, b] = luxColor(lux[k]); img.data[k * 4] = r; img.data[k * 4 + 1] = g; img.data[k * 4 + 2] = b; img.data[k * 4 + 3] = 215;
  }
  c.putImageData(img, 0, 0);
  const bin = atob(cv.toDataURL('image/png').split(',')[1]), a = new Uint8Array(bin.length);
  for (let k = 0; k < bin.length; k++) a[k] = bin.charCodeAt(k);
  return (res.heat[fi] = URL.createObjectURL(new Blob([a], { type: 'image/png' })));
}
