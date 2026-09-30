// Aksonometri presentasi (tab "Presentasi"): gambar exploded axonometric ala diagram arsitek —
// lantai/lapisan ditarik ke atas dengan garis bantu putus-putus, tiap bagian diberi keterangan
// (nama + spesifikasi) lewat garis tarikan yang teksnya bisa diedit dan digeser naik-turun.
// Proyeksi isometrik 30°: u = (x − y)·cos30 · S, v = (x + y)·sin30 · S − z·S (satuan dunia = meter).
import { TYPES, RULES, ARAH8, SARANG_JENIS } from './planner-data.js?v=20260930b';
import { levels, floorRect, floorHt, structure, center } from './planner-geom.js?v=20260930b';

export const AXO_TIPE = [
  ['semua', 'Lengkap per lantai'],
  ['interior', 'Interior (tata ruang)'],
  ['eksterior', 'Eksterior (massa bangunan)'],
  ['item', 'Breakdown item'],
];
export const AXO_PALET = [['warna', 'Berwarna'], ['mono', 'Monokrom teknis'], ['sketsa', 'Sketsa hangat']];
export const AXO_DEFAULT = { tipe: 'semua', palet: 'warna', gap: 2.2, garis: 1, ket: 1, lbl: {} };

const C30 = Math.cos(Math.PI / 6);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const f1 = n => Math.round(n * 10) / 10;
const fmt = n => (+n).toLocaleString('id-ID');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// #rrggbb digelapkan/diterangkan (f<1 gelap utk sisi kanan, f>1 terang)
const sh = (hex, f) => '#' + [1, 3, 5].map(i => clamp(Math.round(parseInt(hex.slice(i, i + 2), 16) * f), 0, 255).toString(16).padStart(2, '0')).join('');

const PAL = {
  warna: {
    bg: '#ffffff', line: '#2f3a44', sub: '#5a6472', guide: '#a7b0ba', tanah: '#e7efe3',
    slab: '#eef1f4', wall: '#f4f6f8', wallO: 0.26,
    zona: { inap: '#9ccc8f', jalur: '#f2b263', void: '#7fb3e8', audio: '#b39ddb', kolam: '#7fd4f0', tangga: '#c9b29b', pintu: '#8d99a6' },
    twinap: '#534AB7', twtarik: '#C62828', hexa: '#6A1B9A', lmb: '#D85A30', sirip: '#8a5a2b', kolom: '#8a939d', sarang: '#2E7D32', sekat: '#4a5560',
  },
  mono: {
    bg: '#ffffff', line: '#3d434b', sub: '#6b7280', guide: '#b6bcc3', tanah: '#f2f3f4',
    slab: '#f7f8f9', wall: '#fbfcfd', wallO: 0.32,
    zona: { inap: '#e2e5e8', jalur: '#eef0f2', void: '#d6dbe0', audio: '#e0e3e7', kolam: '#e8ebee', tangga: '#e4e6e9', pintu: '#c8cdd3' },
    twinap: '#4b5563', twtarik: '#1f2937', hexa: '#4b5563', lmb: '#1f2937', sirip: '#7c8590', kolom: '#949ca4', sarang: '#6b7280', sekat: '#5a626b',
  },
  sketsa: {
    bg: '#fbf7ef', line: '#4a4236', sub: '#7a6f5d', guide: '#c4b8a4', tanah: '#eee5d2',
    slab: '#f3ecdd', wall: '#f8f2e5', wallO: 0.3,
    zona: { inap: '#c9d6a3', jalur: '#e8c48a', void: '#a9c4d6', audio: '#c9b8d8', kolam: '#a9d3dd', tangga: '#d3bfa4', pintu: '#a89a83' },
    twinap: '#6d5fc4', twtarik: '#b34a3f', hexa: '#7d5a9e', lmb: '#c06a3e', sirip: '#96703f', kolom: '#95897a', sarang: '#5d7d4f', sekat: '#6a5f4d',
  },
};

// ---------- inti: bangun geometri + keterangan ----------
function build(m, o, stat, cab) {
  const pal = PAL[o.palet] || PAL.warna, S = o.s || 26, CX = C30 * S, CY = 0.5 * S;
  const gap = clamp(Number.isFinite(+o.gap) ? +o.gap : 2.2, 0, 6), LV = levels(m);
  let minU = 1e9, maxU = -1e9, minV = 1e9, maxV = -1e9;
  const pt = (x, y, z) => {
    const u = (x - y) * CX, v = (x + y) * CY - z * S;
    if (u < minU) minU = u; if (u > maxU) maxU = u; if (v < minV) minV = v; if (v > maxV) maxV = v;
    return [f1(u), f1(v)];
  };
  const G = [];   // potongan svg urut belakang → depan
  const poly = (pts, fill, op = 1, st = pal.line, sw = 0.9, extra = '') =>
    G.push(`<polygon points="${pts.map(p => p.join(',')).join(' ')}" fill="${fill}" fill-opacity="${op}"${st ? ` stroke="${st}" stroke-width="${sw}" stroke-linejoin="round"` : ' stroke="none"'}${extra}/>`);
  // balok/box: dua sisi terlihat (x = x+w menghadap kanan, y = y+h menghadap kiri) + atap
  const prism = (x, y, w, h, z, dz, col, op = 1, sw = 0.9) => {
    poly([pt(x + w, y, z), pt(x + w, y + h, z), pt(x + w, y + h, z + dz), pt(x + w, y, z + dz)], sh(col, 0.78), op, pal.line, sw);
    poly([pt(x, y + h, z), pt(x + w, y + h, z), pt(x + w, y + h, z + dz), pt(x, y + h, z + dz)], sh(col, 0.9), op, pal.line, sw);
    poly([pt(x, y, z + dz), pt(x + w, y, z + dz), pt(x + w, y + h, z + dz), pt(x, y + h, z + dz)], col, op, pal.line, sw);
  };
  const flat = (x, y, w, h, z, col, op = 1, st = null, sw = 0.8, extra = '') =>
    poly([pt(x, y, z), pt(x + w, y, z), pt(x + w, y + h, z), pt(x, y + h, z)], col, op, st, sw, extra);
  const wallQ = (x1, y1, x2, y2, z, hh, col, op = 1, sw = 0.8, dash = '') =>
    poly([pt(x1, y1, z), pt(x2, y2, z), pt(x2, y2, z + hh), pt(x1, y1, z + hh)], col, op, pal.line, sw, dash);
  const line = (a, b, st, sw = 0.9, dash = '', op = 1) => G.push(`<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="${st}" stroke-width="${sw}"${dash ? ` stroke-dasharray="${dash}"` : ''} stroke-opacity="${op}"/>`);
  const dot = (x, y, z, r, col) => { const p = pt(x, y, z); G.push(`<circle cx="${p[0]}" cy="${p[1]}" r="${f1(r)}" fill="${col}" stroke="${pal.bg}" stroke-width="0.7"/>`); };
  // detail item: papan sirip nyata (jarak & arah sesuai item), corong tweeter, cangkir sarang, riak kolam, anak tangga
  const siripLines = (r, z, step, col, op2 = 0.7, sw = 0.7) => {
    const alongX = r.o ? r.o === 'x' : r.w >= r.h;   // papan sejajar sisi panjang; o memaksa arah
    const span = alongX ? r.h : r.w, n = Math.max(2, Math.round(span / step));
    for (let k2 = 1; k2 < n; k2++) {
      const q = (k2 * span) / n;
      line(pt(alongX ? r.x + 0.08 : r.x + q, alongX ? r.y + q : r.y + 0.08, z),
        pt(alongX ? r.x + r.w - 0.08 : r.x + q, alongX ? r.y + q : r.y + r.h - 0.08, z), col, sw, '', op2);
    }
  };
  const horn = (cx, cy, z, ang, col, sc2 = 1) => {   // tweeter AX-65: magnet kotak + corong trapesium menghadap ang (0°=+x)
    const a = (ang * Math.PI) / 180, ux = Math.cos(a), uy = Math.sin(a), vx = -uy, vy = ux;
    const L1 = 0.1 * sc2, L2 = 0.17 * sc2, w1 = 0.055 * sc2, w2 = 0.13 * sc2;
    poly([pt(cx - ux * L1 + vx * w1, cy - uy * L1 + vy * w1, z), pt(cx + vx * w1, cy + vy * w1, z), pt(cx - vx * w1, cy - vy * w1, z), pt(cx - ux * L1 - vx * w1, cy - uy * L1 - vy * w1, z)], sh(col, 0.72), 1, pal.bg, 0.5);
    poly([pt(cx + vx * w1, cy + vy * w1, z), pt(cx + ux * L2 + vx * w2, cy + uy * L2 + vy * w2, z), pt(cx + ux * L2 - vx * w2, cy + uy * L2 - vy * w2, z), pt(cx - vx * w1, cy - vy * w1, z)], col, 1, pal.bg, 0.5);
  };
  const sarangSym = (x, y, z, r, col) => { const p = pt(x, y, z); G.push(`<path d="M ${f1(p[0] - r)} ${f1(p[1])} a ${f1(r)} ${f1(r * 0.9)} 0 0 0 ${f1(2 * r)} 0 z" fill="${col}" stroke="${pal.bg}" stroke-width="0.6"/>`); };
  const kolamSym = (it, z) => { const c = center(it), p = pt(c.x, c.y, z), r = Math.max(4, S * Math.min(it.w, it.h) * 0.28);
    G.push(`<path d="M ${f1(p[0] - r)} ${f1(p[1])} q ${f1(r / 2)} ${f1(-r / 3)} ${f1(r)} 0 t ${f1(r)} 0" fill="none" stroke="${sh(zonaCol('kolam'), 0.6)}" stroke-width="0.9"/><path d="M ${f1(p[0] - r * 0.7)} ${f1(p[1] + r * 0.28)} q ${f1(r * 0.35)} ${f1(-r * 0.25)} ${f1(r * 0.7)} 0 t ${f1(r * 0.7)} 0" fill="none" stroke="${sh(zonaCol('kolam'), 0.6)}" stroke-width="0.8"/>`); };
  const tanggaSym = (it, z) => { const alongX = it.w >= it.h, n = 5;
    for (let k2 = 1; k2 < n; k2++) { const q = (k2 * (alongX ? it.w : it.h)) / n;
      line(pt(alongX ? it.x + q : it.x + 0.06, alongX ? it.y + 0.06 : it.y + q, z), pt(alongX ? it.x + q : it.x + it.w - 0.06, alongX ? it.y + it.h - 0.06 : it.y + q, z), sh(zonaCol('tangga'), 0.62), 0.7, '', 0.85); } };
  const CO = [];   // keterangan {id,t,spec,warna,p:[x,y,z]}
  const co = (id, t, spec, warna, p) => CO.push({ id, t, spec, warna, p });

  const F0 = floorRect(m, m.floors[0]);
  const zonaCol = t => pal.zona[t] || pal.slab;
  const itemsOf = t => LV.flatMap((fl, i) => fl.items.filter(it => it.t === t).map(it => ({ ...it, fi: i })));
  const guides = (F, zTop, zBot) => {   // garis bantu putus-putus antar lapisan (4 sudut)
    if (!o.garis || zTop <= zBot) return;
    [[F.x, F.y], [F.x + F.w, F.y], [F.x + F.w, F.y + F.h], [F.x, F.y + F.h]]
      .forEach(([x, y]) => line(pt(x, y, zBot), pt(x, y, zTop), pal.guide, 0.8, '4 4', 0.85));
  };
  // isi satu lantai (dipakai tipe semua & interior)
  const isiLantai = (fl, i, z0, penuh) => {
    const F = floorRect(m, fl), ht = floorHt(m, fl);
    prism(F.x, F.y, F.w, F.h, z0, 0.14, pal.slab, 1, 0.9);   // plat lantai
    const zt = z0 + 0.14;
    if (penuh) {   // dinding belakang (dua sisi jauh) translusen
      wallQ(F.x, F.y, F.x + F.w, F.y, zt, ht, pal.wall, pal.wallO, 0.7);
      wallQ(F.x, F.y, F.x, F.y + F.h, zt, ht, pal.wall, pal.wallO, 0.7);
    }
    const zs = ['inap', 'jalur', 'audio', 'kolam', 'tangga', 'pintu'];
    fl.items.filter(it => zs.includes(it.t)).sort((a, b) => a.x + a.y - b.x - b.y)
      .forEach(it => {
        flat(it.x, it.y, it.w, it.h, zt + 0.02, zonaCol(it.t), it.t === 'pintu' ? 0.9 : 0.75, sh(zonaCol(it.t), 0.7), 0.7);
        if (it.t === 'inap' || it.t === 'jalur') siripLines(it, zt + 0.04, Math.max(0.4, (it.gap || RULES.siripJarak) * 2), sh(zonaCol(it.t), 0.55), 0.5, 0.55);   // papan sirip (dijarangkan 2×)
        if (it.t === 'kolam') kolamSym(it, zt + 0.05);
        if (it.t === 'tangga') tanggaSym(it, zt + 0.04);
      });
    fl.items.filter(it => it.t === 'void').forEach(v => {   // void = lubang gelap + silang
      flat(v.x, v.y, v.w, v.h, zt + 0.03, sh(zonaCol('void'), 0.55), 0.9, sh(zonaCol('void'), 0.5), 0.8);
      line(pt(v.x, v.y, zt + 0.03), pt(v.x + v.w, v.y + v.h, zt + 0.03), sh(zonaCol('void'), 0.45), 0.7);
      line(pt(v.x + v.w, v.y, zt + 0.03), pt(v.x, v.y + v.h, zt + 0.03), sh(zonaCol('void'), 0.45), 0.7);
    });
    if (penuh && m.showStruktur !== false) {   // kolom pada grid
      const st2 = structure(m, F);
      st2.xs.forEach(x => st2.ys.forEach(y => {
        const cx = clamp(x, F.x + 0.09, F.x + F.w - 0.09), cy = clamp(y, F.y + 0.09, F.y + F.h - 0.09);
        prism(cx - 0.09, cy - 0.09, 0.18, 0.18, zt, ht - 0.14, pal.kolom, 0.95, 0.6);
      }));
    }
    (fl.walls || []).slice().sort((a, b) => Math.min(a.x1 + a.y1, a.x2 + a.y2) - Math.min(b.x1 + b.y1, b.x2 + b.y2)).forEach(w => {   // sekat
      const gant = w.jenis === 'gantung', bata = w.bahan === 'bata';
      const hb = gant ? ht * 0.45 : ht - 0.14, zb = gant ? zt + ht - 0.14 - hb : zt;
      wallQ(w.x1, w.y1, w.x2, w.y2, zb, hb, bata ? '#b6b3ab' : pal.sekat, bata ? 0.95 : 0.55, 0.8, gant ? ' stroke-dasharray="3 2"' : '');
    });
    fl.items.filter(it => it.t === 'lmb').forEach(l => {   // LMB pada dinding: kusen terang + lubang gelap
      const hz = l.w >= l.h, cx = l.x + l.w / 2, cy = l.y + l.h / 2, half = Math.max(l.w, l.h) / 2, th = l.tcm ? l.tcm / 100 : 0.5;
      const seg = (hf, z2, hh2, col, sw2) => wallQ(hz ? cx - hf : cx, hz ? cy : cy - hf, hz ? cx + hf : cx, hz ? cy : cy + hf, z2, hh2, col, 1, sw2);
      seg(half + 0.07, zt + ht * 0.45 - 0.07, th + 0.14, sh(pal.lmb, 1.25), 0.7);   // kusen
      seg(half, zt + ht * 0.45, th, '#20242a', 0.6);                                // lubang dicat hitam
    });
    fl.items.filter(it => it.t === 'twinap' || it.t === 'twtarik').forEach(t => {
      const c = center(t), ang = Number.isFinite(t.dir) ? t.dir : 90;
      line(pt(c.x, c.y, zt), pt(c.x, c.y, zt + 0.4), pal[t.t], 0.8, '', 0.8);       // tiang gantung
      horn(c.x, c.y, zt + 0.42, ang, pal[t.t], 1);                                  // corong menghadap arahnya
    });
    fl.items.filter(it => it.t === 'hexa').forEach(t => {   // hexagonal: 6 corong melingkar
      const c = center(t), rr = 0.14;
      line(pt(c.x, c.y, zt), pt(c.x, c.y, zt + 0.85), pal.hexa, 0.8, '', 0.7);
      for (let k2 = 0; k2 < 6; k2++) { const a2 = ((k2 * 60 - 90) * Math.PI) / 180; dot(c.x + rr * Math.cos(a2), c.y + rr * Math.sin(a2), zt + 0.9, Math.max(1.4, S * 0.05), pal.hexa); }
    });
    fl.items.filter(it => it.t === 'sarang').forEach(t => { const c = center(t); sarangSym(c.x, c.y, zt + 0.1, Math.max(1.8, S * 0.06), pal.sarang); });
    if (penuh) {   // dinding depan sangat tipis supaya isi terlihat
      wallQ(F.x, F.y + F.h, F.x + F.w, F.y + F.h, zt, ht, pal.wall, 0.1, 0.8);
      wallQ(F.x + F.w, F.y, F.x + F.w, F.y + F.h, zt, ht, pal.wall, 0.1, 0.8);
    }
    return { F, ht };
  };
  const tanah = () => {   // bidang tapak/lahan
    const g = 2.5, F = { x: F0.x - g, y: F0.y - g, w: F0.w + 2 * g, h: F0.h + 2 * g };
    flat(F.x, F.y, F.w, F.h, -0.04, pal.tanah, 1, sh(pal.tanah, 0.8), 0.9);
    for (let x = Math.ceil(F.x); x <= F.x + F.w; x += 2) line(pt(x, F.y, -0.03), pt(x, F.y + F.h, -0.03), sh(pal.tanah, 0.88), 0.5);
    for (let y = Math.ceil(F.y); y <= F.y + F.h; y += 2) line(pt(F.x, y, -0.03), pt(F.x + F.w, y, -0.03), sh(pal.tanah, 0.88), 0.5);
  };
  const srgO = stat?.sarangN && typeof stat.sarangN === 'object' ? stat.sarangN : {};   // sarangN = {baru,lama,polesan,jadi}
  const srgTot = ['baru', 'lama', 'polesan', 'jadi'].reduce((s2, k) => s2 + (+srgO[k] || 0), 0);
  const angka = { tw: stat?.twinapN, tt: stat?.twtarikN, hx: stat?.hexaN, sirip: stat?.siripM, btg: stat?.siripBatang, pjg: stat?.papanPjg || m.papanPjg || RULES.papanPanjang, kbl: stat?.kabelM, klm: stat?.klemN, srg: srgTot, lmb: stat?.lmbN, inap: stat?.inapN };

  // ---------- tipe: semua / interior ----------
  if (o.tipe === 'semua' || o.tipe === 'interior') {
    const penuh = o.tipe === 'semua';
    if (penuh) tanah();
    let z0 = 0, prevTop = 0;
    LV.forEach((fl, i) => {
      const F = floorRect(m, fl), ht = floorHt(m, fl);
      if (i > 0) guides(F, z0, prevTop);
      isiLantai(fl, i, z0, penuh);
      const nTw = fl.items.filter(t => t.t === 'twinap' || t.t === 'twtarik').length;
      const nSk = (fl.walls || []).length, nLmb = fl.items.filter(t => t.t === 'lmb').length;
      co('lv' + i, `${fl.name} — ${fmt(F.w)}×${fmt(F.h)} m`, `tinggi ${fmt(ht)} m · ${nSk} sekat · ${nTw} tweeter${nLmb ? ` · ${nLmb} LMB` : ''}`,
        pal.slab, [i % 2 ? F.x : F.x + F.w, i % 2 ? F.y : F.y, z0 + ht / 2]);
      prevTop = z0 + ht; z0 += ht + gap;
    });
    prism(floorRect(m, LV[LV.length - 1]).x, floorRect(m, LV[LV.length - 1]).y, floorRect(m, LV[LV.length - 1]).w, floorRect(m, LV[LV.length - 1]).h, z0, 0.12, sh(pal.slab, 0.94), 1, 0.9);   // atap datar
    guides(floorRect(m, LV[LV.length - 1]), z0, prevTop);
    co('atap', 'Atap / dak', 'plat penutup di atas lantai teratas', sh(pal.slab, 0.94), [floorRect(m, LV[LV.length - 1]).x, floorRect(m, LV[LV.length - 1]).y + floorRect(m, LV[LV.length - 1]).h, z0]);
    // keterangan kategori (jangkar = item pertama yang ada)
    const anchor = (t, dz = 0.4) => { const a = itemsOf(t)[0]; if (!a) return null; const c = center(a); let z = 0; for (let k = 0; k < a.fi; k++) z += floorHt(m, LV[k]) + gap; return [c.x, c.y, z + dz]; };
    const cat = (t, id, judul, spec, col) => { const p = anchor(t); if (p) co(id, judul, spec, col, p); };
    if (penuh) {
      cat('twinap', 'twinap', `Tweeter inap (${TYPES.twinap.name.match(/\((.+)\)/)?.[1] || 'AX-65'})`, `${fmt(angka.tw ?? 0)} titik · di papan sirip, menghadap jalan masuk ruang`, pal.twinap);
      cat('twtarik', 'twtarik', 'Tweeter tarik', `${fmt(angka.tt ?? 0)} titik · rantai LMB → void → jalur → inap`, pal.twtarik);
      cat('hexa', 'hexa', 'Tweeter hexagonal (panggil)', `${fmt(angka.hx ?? 0)} unit · mepet di atas LMB`, pal.hexa);
      cat('lmb', 'lmbK', 'LMB — lubang masuk burung', `${fmt(angka.lmb ?? 0)} bh · ${RULES.lmbLebarCm[0]}–${RULES.lmbLebarCm[1]} × ${RULES.lmbTinggiCm[0]}–${RULES.lmbTinggiCm[1]} cm, dicat hitam`, pal.lmb);
      if (angka.sirip) cat('inap', 'sirip', 'Papan sirip', `${fmt(angka.sirip)} m · ${m.siripTebal || RULES.siripTebalCm}×${m.siripLebar || RULES.siripLebarCm} cm · ±${fmt(angka.btg ?? 0)} batang @${fmt(angka.pjg)} m`, pal.sirip);
      if (m.showStruktur !== false) co('kolom', 'Kolom & balok beton', `grid ${fmt(m.kolom)} m (bisa diatur) · tanpa balok anakan`, pal.kolom, [F0.x + Math.min(m.kolom, F0.w), F0.y, floorHt(m, LV[0]) / 2]);
      if (angka.kbl) cat('twinap', 'kabel', 'Kabel tweeter → ruang audio', `±${fmt(angka.kbl)} m · klem tiap 10 cm (${fmt(angka.klm ?? 0)} bh)`, '#c99700');
      if (angka.srg) cat('sarang', 'sarang', 'Titik sarang (pemantauan)', `${fmt(angka.srg)} titik`, pal.sarang);
    } else {
      cat('inap', 'inap', 'Ruang inap + sirip', `${fmt(angka.inap ?? 0)} ruang · gelap <1 lux · maks ${RULES.inapMaks}×${RULES.inapMaks} m`, pal.zona.inap);
      cat('jalur', 'jalur', 'Ruang jalur (transit)', 'remang, diberi sirip & tweeter inap juga', pal.zona.jalur);
      cat('void', 'void', 'Void (lubang terjun)', 'lurus atap → dasar, posisi sama tiap lantai', pal.zona.void);
      cat('audio', 'audio', 'Ruang audio', `±${RULES.audioLuas} m² · boleh di dalam / luar gedung`, pal.zona.audio);
      cat('tangga', 'tangga', 'Tangga (LAL)', 'akses panen antar lantai, jangan lewat void', pal.zona.tangga);
      cat('kolam', 'kolam', 'Kolam air', 'menjaga kelembapan 75–85%', pal.zona.kolam);
      const nB = LV.reduce((s, f) => s + (f.walls || []).filter(w => w.bahan === 'bata').length, 0), nT = LV.reduce((s, f) => s + (f.walls || []).length, 0) - nB;
      if (nT + nB) co('sekat', 'Sekat ruang', `${nT} terpal (tembus kabel) · ${nB} bata`, pal.sekat, (() => { const fl = LV.find(f => (f.walls || []).length); const w = fl.walls[0]; let z = 0; for (let k = 0; k < LV.indexOf(fl); k++) z += floorHt(m, LV[k]) + gap; return [(w.x1 + w.x2) / 2, (w.y1 + w.y2) / 2, z + 1]; })());
    }
  }

  // ---------- tipe: eksterior ----------
  if (o.tipe === 'eksterior') {
    tanah();
    let z0 = 0, prevTop = 0;
    LV.forEach((fl, i) => {
      const F = floorRect(m, fl), ht = floorHt(m, fl);
      if (i > 0) guides(F, z0, prevTop);
      prism(F.x, F.y, F.w, F.h, z0, ht, fl.menara ? sh(pal.wall, 0.93) : pal.wall, 1, 1);
      fl.items.filter(it => it.t === 'lmb').forEach(l => {   // LMB tampak di fasad
        const hz = l.w >= l.h, cx = l.x + l.w / 2, cy = l.y + l.h / 2, half = Math.max(l.w, l.h) / 2;
        wallQ(hz ? cx - half : cx + 0.02, hz ? cy + 0.02 : cy - half, hz ? cx + half : cx + 0.02, hz ? cy + 0.02 : cy + half, z0 + ht * 0.4, (l.tcm ? l.tcm / 100 : 0.5), '#20242a', 1, 0.6);
      });
      fl.items.filter(it => it.t === 'vent').forEach(v => { const c = center(v); dot(c.x, c.y, z0 + ht * 0.35, Math.max(1.2, S * 0.045), sh(pal.wall, 0.7)); });
      co('lv' + i, fl.menara ? `Menara — ${fmt(F.w)}×${fmt(F.h)} m` : `${fl.name} — ${fmt(F.w)}×${fmt(F.h)} m`, `tinggi ${fmt(ht)} m${fl.items.filter(t => t.t === 'lmb').length ? ` · ${fl.items.filter(t => t.t === 'lmb').length} LMB di fasad` : ''}`, pal.wall, [i % 2 ? F.x : F.x + F.w, F.y + (i % 2 ? F.h * 0.3 : 0), z0 + ht / 2]);
      prevTop = z0 + ht; z0 += ht + gap;
    });
    const T = floorRect(m, LV[LV.length - 1]);
    prism(T.x - 0.25, T.y - 0.25, T.w + 0.5, T.h + 0.5, z0, 0.18, sh(pal.slab, 0.9), 1, 1);
    guides(T, z0, prevTop);
    co('atap', 'Atap dak beton', 'overstek ±25 cm keliling', sh(pal.slab, 0.9), [T.x, T.y + T.h, z0 + 0.1]);
    const hadap = ARAH8.reduce((b, a) => (Math.abs(((m.sim?.hadap ?? 0) - a[0] + 540) % 360 - 180) < Math.abs(((m.sim?.hadap ?? 0) - b[0] + 540) % 360 - 180) ? a : b));
    co('dim', `Dimensi ${fmt(m.w)} × ${fmt(m.h)} m`, `tinggi total ±${fmt(stat?.tinggi ?? 0)} m · ${m.floors.length} lantai${m.menara ? ' + menara' : ''}`, pal.line, [F0.x + F0.w, F0.y + F0.h, 0.1]);
    co('hadap', `Hadap ${hadap[1]}`, 'arah datang burung — LMB menghadap ke sini', pal.sub, [F0.x + F0.w / 2, F0.y + F0.h + 2, 0]);
  }

  // ---------- tipe: item (breakdown per kategori) ----------
  if (o.tipe === 'item') {
    const B = { x: F0.x, y: F0.y, w: m.w, h: m.h };
    const plate = z => prism(B.x, B.y, B.w, B.h, z, 0.1, pal.slab, 0.5, 0.7);
    const layers = [];
    if (m.showStruktur !== false) layers.push({ id: 'kolom', t: 'Struktur kolom & balok', spec: `grid ${fmt(m.kolom)} m — jarak bisa diatur, tanpa balok anakan`, col: pal.kolom, draw: z => {
      const st2 = structure(m, B);
      st2.bx.forEach(x => wallQ(x, B.y, x, B.y + B.h, z + 1.1, 0.2, pal.kolom, 0.9, 0.6));
      st2.by.forEach(y => wallQ(B.x, y, B.x + B.w, y, z + 1.1, 0.2, pal.kolom, 0.9, 0.6));
      st2.xs.forEach(x => st2.ys.forEach(y => prism(clamp(x, B.x + 0.09, B.x + B.w - 0.09) - 0.09, clamp(y, B.y + 0.09, B.y + B.h - 0.09) - 0.09, 0.18, 0.18, z, 1.3, pal.kolom, 0.95, 0.6)));
    } });
    layers.push({ id: 'plat', t: 'Plat lantai + void', spec: `${LV.length} level · void menerus sebagai jalur terbang`, col: pal.slab, draw: z => {
      prism(B.x, B.y, B.w, B.h, z, 0.12, pal.slab, 1, 0.8);
      itemsOf('void').forEach(v => { flat(v.x, v.y, v.w, v.h, z + 0.15, sh(pal.zona.void, 0.8), 0.85, sh(pal.zona.void, 0.55), 0.8); });
      itemsOf('tangga').forEach(t => flat(t.x, t.y, t.w, t.h, z + 0.14, pal.zona.tangga, 0.85, sh(pal.zona.tangga, 0.7), 0.7));
    } },
    { id: 'sekat', t: 'Sekat terpal / bata', spec: 'terpal bisa ditembus kabel · bata tidak', col: pal.sekat, draw: z => {
      plate(z);
      LV.forEach(fl => (fl.walls || []).forEach(w => wallQ(w.x1, w.y1, w.x2, w.y2, z + 0.1, 0.9, w.bahan === 'bata' ? '#b6b3ab' : pal.sekat, w.bahan === 'bata' ? 0.95 : 0.5, 0.7, w.jenis === 'gantung' ? ' stroke-dasharray="3 2"' : '')));
    } });
    if (angka.sirip) layers.push({ id: 'sirip', t: 'Papan sirip', spec: `${fmt(angka.sirip)} m · ${m.siripTebal || RULES.siripTebalCm}×${m.siripLebar || RULES.siripLebarCm} cm · jarak ${Math.round(RULES.siripJarak * 100)} cm · ±${fmt(angka.btg ?? 0)} batang @${fmt(angka.pjg)} m`, col: pal.sirip, draw: z => {
      plate(z);
      LV.forEach(fl => fl.items.filter(it => it.t === 'inap' || it.t === 'jalur').forEach(r => {
        flat(r.x, r.y, r.w, r.h, z + 0.3, pal.bg, 0.35, sh(pal.sirip, 1.15), 0.5);
        siripLines(r, z + 0.32, r.gap || RULES.siripJarak, pal.sirip, 0.8, 0.6);   // jarak papan sesungguhnya (25 cm standar)
      }));
    } });
    if (cab?.chs?.length) layers.push({ id: 'kabel', t: 'Jalur kabel per channel', spec: `±${fmt(angka.kbl ?? 0)} m · ${fmt(angka.klm ?? 0)} klem @10 cm · semua berujung di ruang audio`, col: '#c99700', draw: z => {
      plate(z);
      cab.chs.forEach(ch => ch.runs.forEach(r => { if (r.pts?.length > 1) G.push(`<polyline points="${r.pts.map(p => pt(p[0], p[1], z + 0.25).join(',')).join(' ')}" fill="none" stroke="${ch.warna}" stroke-width="1.1" stroke-opacity="0.9" stroke-linejoin="round"/>`); }));
    } });
    if (angka.tw) layers.push({ id: 'twinap', t: 'Tweeter inap', spec: `${fmt(angka.tw)} titik · pola per baris 2-1-2 / 3-2-3 / 4-3-4`, col: pal.twinap, draw: z => { plate(z); itemsOf('twinap').forEach(t => horn(center(t).x, center(t).y, z + 0.28, Number.isFinite(t.dir) ? t.dir : 90, pal.twinap, 1.7)); } });
    if (angka.tt || angka.hx) layers.push({ id: 'twtarik', t: 'Tweeter tarik + hexagonal', spec: `${fmt(angka.tt ?? 0)} tarik · ${fmt(angka.hx ?? 0)} hexagonal (panggil)`, col: pal.twtarik, draw: z => {
      plate(z);
      itemsOf('twtarik').forEach(t => horn(center(t).x, center(t).y, z + 0.28, Number.isFinite(t.dir) ? t.dir : 90, pal.twtarik, 1.7));
      itemsOf('hexa').forEach(t => { const c = center(t); for (let k2 = 0; k2 < 6; k2++) { const a2 = ((k2 * 60 - 90) * Math.PI) / 180; dot(c.x + 0.16 * Math.cos(a2), c.y + 0.16 * Math.sin(a2), z + 0.3, Math.max(1.6, S * 0.055), pal.hexa); } });
    } });
    if (angka.lmb) layers.push({ id: 'lmb', t: 'LMB + LAR (bukaan)', spec: `${fmt(angka.lmb)} LMB · ${fmt(itemsOf('lar').length + itemsOf('larj').length)} LAR`, col: pal.lmb, draw: z => { plate(z); itemsOf('lmb').forEach(l => { flat(l.x - 0.14, l.y - 0.14, l.w + 0.28, l.h + 0.28, z + 0.15, sh(pal.lmb, 1.25), 0.95, sh(pal.lmb, 0.7), 0.6); flat(l.x, l.y, l.w, l.h, z + 0.17, '#20242a', 1, null, 0); }); [...itemsOf('lar'), ...itemsOf('larj')].forEach(l => flat(l.x, l.y, l.w, l.h, z + 0.14, pal.zona.jalur, 0.85, sh(pal.zona.jalur, 0.7), 0.6)); } });
    if (stat?.ventN) layers.push({ id: 'vent', t: 'Ventilasi pipa 4"', spec: `${fmt(stat.ventN)} titik · tiap ±1 m, 60 cm di bawah sirip, elbow ke bawah`, col: pal.kolom, draw: z => { plate(z); itemsOf('vent').forEach(v => { const c = center(v); dot(c.x, c.y, z + 0.22, Math.max(1.6, S * 0.055), pal.bg === '#ffffff' ? '#8a939d' : pal.kolom); } ); } });
    if (angka.srg) layers.push({ id: 'sarang', t: 'Titik sarang', spec: SARANG_JENIS.map(([k]) => (srgO[k] ? `${fmt(srgO[k])} ${k}` : '')).filter(Boolean).join(' · ') || `${fmt(angka.srg)} titik`, col: pal.sarang, draw: z => { plate(z); itemsOf('sarang').forEach(t => { const c = center(t); sarangSym(c.x, c.y, z + 0.2, Math.max(2, S * 0.065), pal.sarang); }); } });
    if (itemsOf('audio').length || m.audio) layers.push({ id: 'audio', t: 'Ruang audio', spec: `±${RULES.audioLuas} m² · ampli, timer, aki — semua kabel berujung di sini`, col: pal.zona.audio, draw: z => { plate(z); itemsOf('audio').forEach(a => prism(a.x, a.y, a.w, a.h, z + 0.1, 0.8, pal.zona.audio, 0.9, 0.7)); } });
    let z0 = 0, prevTop = -0.5;
    layers.forEach((ly, i) => {
      if (i > 0) guides(B, z0, prevTop);
      ly.draw(z0);
      co(ly.id, ly.t, ly.spec, ly.col, [i % 2 ? B.x : B.x + B.w, i % 2 ? B.y + B.h * 0.25 : B.y + B.h * 0.6, z0 + 0.6]);
      prevTop = z0 + 1.2; z0 += 1.2 + gap * 0.75;
    });
  }
  return { G, CO, pal, S, bounds: () => ({ minU, maxU, minV, maxV }), pt };
}

// Daftar keterangan (untuk panel edit di dialog) — teks default sebelum di-override pengguna.
export function axoCallouts(m, o, stat, cab) { return build(m, { ...AXO_DEFAULT, ...o }, stat, cab).CO.map(c => ({ id: c.id, t: c.t, spec: c.spec, warna: c.warna })); }

// SVG lengkap. o: {tipe, palet, gap, garis, ket, lbl, s, edit, brand}
export function axoSVG(m, o, stat, cab) {
  o = { ...AXO_DEFAULT, ...o };
  const { G, CO, pal, S, bounds } = build(m, o, stat, cab);
  const b = bounds(), PADX = 18, PADY = 24;
  let x0 = b.minU - PADX, x1 = b.maxU + PADX, y0 = b.minV - PADY, y1 = b.maxV + PADY;
  const parts = [], LW = Math.max(190, Math.min(250, S * 8.6));
  if (o.ket && CO.length) {
    const midU = (b.minU + b.maxU) / 2, CX = C30 * S, CY = 0.5 * S;
    const pr = key => (o.lbl && o.lbl[`${o.tipe}:${key}`]) || {};
    const items = CO.map(c => ({ ...c, u: (c.p[0] - c.p[1]) * CX, v: (c.p[0] + c.p[1]) * CY - c.p[2] * S, ov: pr(c.id) }))
      .filter(c => c.ov.on !== 0);
    const sideOf = c => (c.ov.sd === 'l' ? -1 : c.ov.sd === 'r' ? 1 : c.u < midU ? -1 : 1);
    [-1, 1].forEach(sd => {
      const col = items.filter(c => sideOf(c) === sd).sort((a, b2) => a.v - b2.v);
      if (!col.length) return;
      const LX = sd < 0 ? x0 - 12 : x1 + 12;   // tepi kolom label
      let bot = -1e9;
      col.forEach(c => {
        const judul = esc(String(c.ov.t ?? c.t).slice(0, 60)), spec = String(c.ov.s ?? c.spec ?? '').slice(0, 90);
        const lines = [];   // spec dibungkus maks 2 baris
        let cur = '';
        spec.split(' ').forEach(w => { if ((cur + ' ' + w).trim().length > 34 && cur) { lines.push(cur); cur = w; } else cur = (cur ? cur + ' ' : '') + w; });
        if (cur) lines.push(cur);
        const ly = Math.max(c.v + (+c.ov.dy || 0), bot + 18);
        bot = ly + lines.slice(0, 2).length * 13 + 4;
        const tx = sd < 0 ? LX - 18 : LX + 18, anchor = sd < 0 ? 'end' : 'start';
        parts.push(`<g${o.edit ? ` data-lb="${o.tipe}:${c.id}" style="cursor:ns-resize"` : ''}>`
          + `<polyline points="${f1(c.u)},${f1(c.v)} ${f1(LX + (sd < 0 ? 6 : -6))},${f1(ly - 4)} ${f1(LX)},${f1(ly - 4)}" fill="none" stroke="${pal.sub}" stroke-width="0.9"/>`
          + `<circle cx="${f1(c.u)}" cy="${f1(c.v)}" r="2.4" fill="${pal.sub}"/>`
          + `<rect x="${f1(sd < 0 ? LX - 12 : LX + 1)}" y="${f1(ly - 10)}" width="11" height="11" rx="2" fill="${c.warna}" stroke="${pal.line}" stroke-width="0.6"/>`
          + `<text x="${f1(tx)}" y="${f1(ly)}" text-anchor="${anchor}" font-weight="600" font-size="12.5" fill="${pal.line}">${judul}</text>`
          + lines.slice(0, 2).map((l, i) => `<text x="${f1(tx)}" y="${f1(ly + 14 + i * 13)}" text-anchor="${anchor}" font-size="10.5" fill="${pal.sub}">${esc(l)}</text>`).join('')
          + '</g>');
        if (bot + 10 > y1) y1 = bot + 10;
      });
      if (sd < 0) x0 -= LW; else x1 += LW;
    });
  }
  if (o.brand) { y1 += 18; parts.push(`<text x="${f1(x1 - 8)}" y="${f1(y1 - 8)}" text-anchor="end" font-size="10" fill="${pal.sub}">GedungWalet.com · Walet Planner</text>`); }
  const W = Math.round(x1 - x0), H = Math.round(y1 - y0);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${f1(x0)} ${f1(y0)} ${W} ${H}" width="${W}" height="${H}" font-family="Roboto, Arial, sans-serif"><rect x="${f1(x0)}" y="${f1(y0)}" width="${W}" height="${H}" fill="${pal.bg}"/><g${o.edit ? '' : ' pointer-events="none"'}>${G.join('')}</g>${parts.join('')}</svg>`;
}
