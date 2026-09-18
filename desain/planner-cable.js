// Kabel tweeter → ruang audio. Channel bisa diatur bebas (mis. tweeter inap 1 lantai = 1 channel, atau dibagi 3 channel
// untuk gedung besar). Jalur kabel selalu siku (mendatar/tegak, tidak diagonal) mengikuti alur sirip & dinding: dicari di
// grid dengan langkah 4 arah, boleh menembus sekat TERPAL tapi tidak sekat BATA / dinding luar; antar lantai lewat jalur
// tegak (riser) di dekat ruang audio. Hasil: panjang kabel per channel + total, jumlah klem (tiap 10 cm), dan polyline
// untuk digambar di denah. Kabel hexagonal otomatis menghitung tinggi gedung + menara sampai atap.
import { RULES, dbTarget, dbMid } from './planner-data.js';
import { levels, floorRect, floorHt, center } from './planner-geom.js';

export const KABEL_WARNA = ['#E53935', '#1E88E5', '#43A047', '#FB8C00', '#8E24AA', '#00ACC1', '#F06292', '#7CB342', '#5E35B1', '#F9A825', '#26A69A', '#D81B60'];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const r1 = v => Math.round(v * 10) / 10;
export const KABEL_JENIS = [['twinap', 'Tweeter inap'], ['twtarik', 'Tweeter tarik'], ['hexa', 'Hexagonal (panggil)']];
// Cakupan lantai channel: -1 = semua, angka = satu lantai, [a, b] = gabungan lantai a–b (gedung kecil: 2 lantai 1 channel).
export const chCover = (ch, li) => ch.f === -1 || (Array.isArray(ch.f) ? li >= ch.f[0] && li <= ch.f[1] : +ch.f === li);

// Daftar channel: dari m.kabel.ch bila sudah diatur; kalau belum, otomatis inap & tarik per lantai + 1 channel hexagonal.
export function channels(m) {
  const tg = dbTarget(m.survey?.env || 'sawah'), LV = levels(m);
  let list = Array.isArray(m.kabel?.ch) && m.kabel.ch.length ? m.kabel.ch : null;
  if (!list) {
    list = [];
    LV.forEach((fl, i) => {
      const nm = fl.menara ? 'menara' : `Lt ${i + 1}`;
      if (fl.items.some(t => t.t === 'twinap')) list.push({ t: 'twinap', f: i, nm: `Inap ${nm}`, vol: dbMid(tg.inap) });
      if (fl.items.some(t => t.t === 'twtarik')) list.push({ t: 'twtarik', f: i, nm: `Tarik ${nm}`, vol: dbMid(tg.tarik) });
    });
    if (LV.some(fl => fl.items.some(t => t.t === 'hexa'))) list.push({ t: 'hexa', f: -1, nm: 'Panggil (hexagonal)', vol: dbMid(tg.panggil) });
  }
  return list.map((c, k) => ({ n: 1, on: c.on !== false, fd: '', ket: '', ...c, n: clamp(Math.round(+c.n || 1), 1, 6), vol: clamp(Math.round(+c.vol || 70), 40, 110), warna: KABEL_WARNA[k % KABEL_WARNA.length], id: c.id || 'ch' + k }));
}
export const audioRoom = m => { for (let i = 0; i < levels(m).length; i++) { const it = levels(m)[i].items.find(z => z.t === 'audio'); if (it) return { it, li: i }; } return null; };

// Grid rute per lantai: sel 0,25 m; sel sekat BATA terhalang (kabel tidak boleh menembus dinding, terpal boleh).
function gridOf(m, fl) {
  const F = floorRect(m, fl), cs = 0.25;
  const nx = Math.max(2, Math.ceil(F.w / cs)), ny = Math.max(2, Math.ceil(F.h / cs));
  const blk = new Uint8Array(nx * ny);
  fl.walls.filter(w => w.bahan === 'bata').forEach(w => {
    const dx = w.x2 - w.x1, dy = w.y2 - w.y1, L2 = dx * dx + dy * dy || 1e-9, ht = 0.16;
    const i0 = Math.max(0, Math.floor((Math.min(w.x1, w.x2) - ht - F.x) / cs)), i1 = Math.min(nx - 1, Math.floor((Math.max(w.x1, w.x2) + ht - F.x) / cs));
    const j0 = Math.max(0, Math.floor((Math.min(w.y1, w.y2) - ht - F.y) / cs)), j1 = Math.min(ny - 1, Math.floor((Math.max(w.y1, w.y2) + ht - F.y) / cs));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const px = F.x + (i + 0.5) * cs, py = F.y + (j + 0.5) * cs, t = clamp(((px - w.x1) * dx + (py - w.y1) * dy) / L2, 0, 1);
      if (Math.hypot(px - w.x1 - t * dx, py - w.y1 - t * dy) <= ht) blk[j * nx + i] = 1;
    }
  });
  const cell = (x, y) => [clamp(Math.floor((x - F.x) / cs), 0, nx - 1), clamp(Math.floor((y - F.y) / cs), 0, ny - 1)];
  const free = k => { if (!blk[k]) return k; for (const d of [1, -1, nx, -nx, 2, -2, 2 * nx, -2 * nx]) { const q = k + d; if (q >= 0 && q < blk.length && !blk[q]) return q; } return k; };
  return { F, cs, nx, ny, blk, cell, free };
}
// Segmen lurus bebas sekat bata? (dicek dengan sampel tiap 12 cm)
function freeSeg(g, a, b) {
  const L = Math.hypot(b.x - a.x, b.y - a.y);
  for (let d = 0; d <= L; d += 0.12) {
    const x = a.x + ((b.x - a.x) * d) / (L || 1), y = a.y + ((b.y - a.y) * d) / (L || 1);
    const i = Math.floor((x - g.F.x) / g.cs), j = Math.floor((y - g.F.y) / g.cs);
    if (i >= 0 && j >= 0 && i < g.nx && j < g.ny && g.blk[j * g.nx + i]) return false;
  }
  return true;
}
// Jalur RAPI antar dua titik: lurus bila segaris, kalau tidak belok SATU sudut siku (L) — seperti instalasi asli.
// Hanya bila kedua lengan L terhalang bata, cari jalan memutar dengan BFS.
function lRoute(g, a, b) {
  if (Math.abs(a.x - b.x) < 0.02 || Math.abs(a.y - b.y) < 0.02) {
    if (freeSeg(g, a, b)) return { len: Math.abs(a.x - b.x) + Math.abs(a.y - b.y), pts: [[a.x, a.y], [b.x, b.y]], tembus: false };
  }
  for (const via of [{ x: b.x, y: a.y }, { x: a.x, y: b.y }]) {
    if (freeSeg(g, a, via) && freeSeg(g, via, b)) return { len: Math.abs(a.x - b.x) + Math.abs(a.y - b.y), pts: [[a.x, a.y], [via.x, via.y], [b.x, b.y]], tembus: false };
  }
  return route(g, a, b);
}
// buang titik segaris agar polyline bersih
function rapikan(pts) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const [ax, ay] = out[out.length - 1], [bx, by] = pts[i], [cx2, cy2] = pts[i + 1];
    if ((Math.abs(ax - bx) < 0.01 && Math.abs(bx - cx2) < 0.01) || (Math.abs(ay - by) < 0.01 && Math.abs(by - cy2) < 0.01)) continue;
    if (Math.abs(ax - bx) < 0.01 && Math.abs(ay - by) < 0.01) continue;
    out.push(pts[i]);
  }
  out.push(pts[pts.length - 1]);
  return out;
}
// Jalur siku terpendek antar dua titik (BFS 4 arah). Kembali {len, pts (sudut belok saja), tembus (terpaksa lewat bata)}.
function route(g, a, b) {
  const { nx, ny, cs, blk, F } = g, s = g.free(g.cell(a.x, a.y).reduce((i, j) => j * nx + i)), e = g.free(g.cell(b.x, b.y).reduce((i, j) => j * nx + i));
  if (s === e) return { len: Math.abs(a.x - b.x) + Math.abs(a.y - b.y), pts: [[a.x, a.y], [b.x, a.y], [b.x, b.y]], tembus: false };
  const prev = new Int32Array(nx * ny).fill(-1), q = [s];
  prev[s] = s;
  while (q.length) {
    const k = q.shift(); if (k === e) break;
    const i = k % nx;
    for (const d of [k - 1, k + 1, k - nx, k + nx]) {
      if (d < 0 || d >= nx * ny || (d === k - 1 && i === 0) || (d === k + 1 && i === nx - 1) || blk[d] || prev[d] !== -1) continue;
      prev[d] = k; q.push(d);
    }
  }
  if (prev[e] === -1) return { len: Math.abs(a.x - b.x) + Math.abs(a.y - b.y), pts: [[a.x, a.y], [b.x, a.y], [b.x, b.y]], tembus: true };   // terkurung bata
  const cells = []; for (let k = e; k !== s; k = prev[k]) cells.push(k); cells.push(s); cells.reverse();
  const P = k => [F.x + ((k % nx) + 0.5) * cs, F.y + (Math.floor(k / nx) + 0.5) * cs];
  const pts = [[a.x, a.y]];
  for (let i = 1; i < cells.length - 1; i++) {
    const d0 = cells[i] - cells[i - 1], d1 = cells[i + 1] - cells[i];
    if (d0 !== d1) pts.push(P(cells[i]));
  }
  pts.push([b.x, b.y]);
  let len = 0; for (let i = 1; i < pts.length; i++) len += Math.abs(pts[i][0] - pts[i - 1][0]) + Math.abs(pts[i][1] - pts[i - 1][1]);
  return { len, pts, tembus: false };
}
// Urutan "ular": baris demi baris mengikuti alur sirip, bolak-balik — kabel rapi tidak melintang diagonal.
function snake(tws) {
  const rows = new Map();
  tws.forEach(t => { const c = center(t), r = Math.round(c.y); (rows.get(r) || rows.set(r, []).get(r)).push({ x: c.x, y: c.y, id: t.id }); });
  const out = [];
  [...rows.keys()].sort((a, b) => a - b).forEach((r, k) => {
    const row = rows.get(r).sort((a, b) => a.x - b.x);
    out.push(...(k % 2 ? row.reverse() : row));
  });
  return out;
}

let cache = { sig: '', res: null };
// Hitung semua kabel: per channel {len (m), klem, runs per lantai (polyline), jumlah tweeter}; total & jumlah klem.
export function cableInfo(m) {
  const sig = JSON.stringify([m.w, m.h, m.floorH, m.floors, m.menara || null, m.kabel || null, m.audio?.layout ? 1 : 0]);
  if (cache.sig === sig) return cache.res;
  const LV = levels(m), hts = LV.map(fl => floorHt(m, fl)), base = []; hts.reduce((a, h) => (base.push(a), a + h), 0);
  const au = audioRoom(m), F0 = floorRect(m, LV[0]);
  // titik riser: tengah ruang audio, ditarik ke dalam batas lantai bila ruang audio di luar gedung
  const ac = au ? center(au.it) : { x: F0.x + 0.3, y: F0.y + 0.3 };
  const riser = { x: clamp(ac.x, F0.x + 0.2, F0.x + F0.w - 0.2), y: clamp(ac.y, F0.y + 0.2, F0.y + F0.h - 0.2) };
  const luarRun = Math.abs(ac.x - riser.x) + Math.abs(ac.y - riser.y);          // ruang audio di luar → kabel keluar dinding
  const grids = LV.map(fl => gridOf(m, fl));
  const rute = m.kabel?.rute || {};
  const chs = channels(m).map(ch => {
    let len = 0, tembus = false, count = 0;
    const runs = [];
    LV.forEach((fl, li) => {
      if (!chCover(ch, li)) return;
      const tws = fl.items.filter(t => t.t === ch.t);
      if (!tws.length) return;
      count += tws.length;
      const g = grids[li];
      // jalur manual (digambar pengguna): panjang = jalur + sambungan siku tiap tweeter ke jalur + riser
      const man = ch.t !== 'hexa' ? rute[ch.id]?.[li] : null;
      if (Array.isArray(man) && man.length >= 2) {
        let trunk = 0;
        for (let q = 1; q < man.length; q++) trunk += Math.abs(man[q][0] - man[q - 1][0]) + Math.abs(man[q][1] - man[q - 1][1]);
        tws.forEach(t => {
          const c = center(t); let best = null;
          for (let q = 1; q < man.length; q++) {
            const [ax, ay] = man[q - 1], [bx, by] = man[q], dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1e-9;
            const tt = clamp(((c.x - ax) * dx + (c.y - ay) * dy) / L2, 0, 1), qx = ax + dx * tt, qy = ay + dy * tt;
            const d = Math.abs(c.x - qx) + Math.abs(c.y - qy);
            if (!best || d < best.d) best = { d, qx, qy };
          }
          if (best) { len += best.d; runs.push({ f: li, pts: [[c.x, c.y], [best.qx, c.y], [best.qx, best.qy]], drop: true }); }
        });
        len += trunk + base[li] + 1.2;
        const blkAt = (x, y) => { const i = Math.floor((x - g.F.x) / g.cs), j = Math.floor((y - g.F.y) / g.cs); return i >= 0 && j >= 0 && i < g.nx && j < g.ny && g.blk[j * g.nx + i]; };
        for (let q = 1; q < man.length && !tembus; q++) {
          const [ax, ay] = man[q - 1], [bx, by] = man[q], L = Math.hypot(bx - ax, by - ay) || 1e-9;
          for (let d2 = 0.08; d2 < L; d2 += 0.15) if (blkAt(ax + ((bx - ax) * d2) / L, ay + ((by - ay) * d2) / L)) { tembus = true; break; }
        }
        const e0 = man[0], e1 = man[man.length - 1];
        const jauh = Math.abs(e1[0] - riser.x) + Math.abs(e1[1] - riser.y) >= Math.abs(e0[0] - riser.x) + Math.abs(e0[1] - riser.y) ? e1 : e0;
        runs.push({ f: li, pts: man.map(p => [p[0], p[1]]), manual: true, ujung: [jauh[0], jauh[1]] });
        return;
      }
      const rs = { x: clamp(riser.x, g.F.x + 0.2, g.F.x + g.F.w - 0.2), y: clamp(riser.y, g.F.y + 0.2, g.F.y + g.F.h - 0.2) };
      const ord = snake(tws), per = Math.ceil(ord.length / ch.n);
      for (let k = 0; k < ch.n; k++) {
        const grp = ord.slice(k * per, (k + 1) * per);
        if (!grp.length) continue;
        let prev = rs; const pts = [[rs.x, rs.y]];
        grp.forEach(p => { const r = lRoute(g, prev, p); len += r.len; tembus = tembus || r.tembus; pts.push(...r.pts.slice(1)); prev = p; });
        len += base[li] + 1.2;                                                   // turun riser ke ampli + slack
        runs.push({ f: li, pts: rapikan(pts), ujung: [grp[grp.length - 1].x, grp[grp.length - 1].y] });
      }
      if (ch.t === 'hexa') {
        // hexagonal di atap: naik setinggi gedung (+ menara) dari riser lalu mendatar di atap
        const H = base[LV.length - 1] + hts[LV.length - 1];
        tws.forEach(t => { const c = center(t); len += H + 0.8 + Math.abs(c.x - riser.x) + Math.abs(c.y - riser.y); });
        len -= base[li] + 1.2;                                                    // pengganti hitungan riser standar di atas
      }
    });
    len += luarRun * Math.max(1, ch.n);
    const klem = Math.ceil(len / RULES.klemJarak);
    return { ...ch, len: r1(len), klem, runs, count, tembus };
  }).filter(c => c.count);
  const total = r1(chs.reduce((s, c) => s + c.len, 0)), klem = chs.reduce((s, c) => s + c.klem, 0);
  const res = { chs, total, klem, riser, au, luar: !!au && (() => { const F = floorRect(m, LV[au.li]), c = center(au.it); return c.x < F.x || c.x > F.x + F.w || c.y < F.y || c.y > F.y + F.h; })() };
  cache = { sig, res };
  return res;
}
