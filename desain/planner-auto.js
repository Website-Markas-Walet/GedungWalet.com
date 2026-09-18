// Generator denah otomatis dari jawaban "pengamatan cepat" (juga dipakai tombol "Isi otomatis lantai ini").
// Tiap lantai boleh beda ukuran/posisi: void diletakkan di area yang dimiliki SEMUA lantai supaya terjun lurus, lalu tiap
// lantai ditata di sekelilingnya: ruang void bersekat (LAR void) → ruang jalur → LAR inap → ruang inap bersirip.
// Tweeter tarik berantai LMB → LAR void → jalur → LAR inap → inap; tweeter inap menghadap LAR.
import { RULES, SURVEY_DEFAULT, TW } from './planner-data.js';
import { ovArea, floorRect, floorHt, intersect, twinapPattern, snapHexa } from './planner-geom.js';

const r2 = v => Math.round(v * 100) / 100;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const fmt = n => (+n).toLocaleString('id-ID');
let seq = 0;
const uid = () => Math.random().toString(36).slice(2, 7) + (seq++).toString(36);
const M = 0.15;      // jarak aman dari dinding luar
const JALUR = 2.2;   // kedalaman ruang jalur (m)

export function generate(m, answers, onlyFloor = -1) {
  const ans = { ...SURVEY_DEFAULT, ...(answers || {}) };
  const n = m.floors.length, top = n - 1;
  const rects = m.floors.map(fl => floorRect(m, fl));
  const tinggi = m.floors.reduce((s, fl) => s + floorHt(m, fl), 0);
  const C = intersect(rects) || rects[top];                // area bersama semua lantai → tempat void lurus
  const needMenara = tinggi < RULES.menaraWajibJikaTinggi;
  const mid = C.h >= 20;                                    // area panjang → void & menara di tengah (hal. 227-230)
  let side = ans.burung === '?' ? 'depan' : ans.burung;
  if (mid && !needMenara && (side === 'depan' || side === 'belakang')) side = 'kanan'; // tanpa menara, LMB harus di dinding luar
  const [rvw, rvh] = RULES.voidUntuk(C.w);
  const vw = r2(clamp(rvw, 1, C.w - 2 * M - (C.w > 4 ? 1 : 0.3)));
  const vh = r2(clamp(rvh, 1, mid ? C.h * 0.2 : C.h * 0.3));
  const vx = r2(side === 'kiri' ? C.x + M : side === 'kanan' ? C.x + C.w - M - vw : C.x + (C.w - vw) / 2);
  const vy = r2(mid ? C.y + (C.h - vh) / 2 : side === 'belakang' ? C.y + C.h - M - vh : C.y + M);
  const vcx = vx + vw / 2, vmid = vy + vh / 2;
  const ventStep = ans.rh === 'lembab' ? 2 : RULES.ventJarak;
  const tinggiMenara = ans.tinggi === 'ya' ? 3 : 2.5;
  if (!m.kolom) m.kolom = RULES.kolom;
  let info = null;

  m.floors.forEach((fl, i) => {
    if (onlyFloor >= 0 && i !== onlyFloor) return;
    const F = rects[i], X0 = F.x + M, X1 = F.x + F.w - M, Y0 = F.y + M, Y1 = F.y + F.h - M;
    const items = [], walls = [];
    const add = (t, x, y, w, h, ex = {}) => { const it = { id: uid(), t, x: r2(x), y: r2(y), w: r2(w), h: r2(h), ...ex }; items.push(it); return it; };
    const tw = (t, x, y, ex) => add(t, x - TW / 2, y - TW / 2, TW, TW, ex);
    const wall = (x1, y1, x2, y2, jenis) => walls.push({ id: uid(), x1: r2(x1), y1: r2(y1), x2: r2(x2), y2: r2(y2), jenis });
    const jenis = i === 0 ? 'gantung' : 'penuh';          // sekat gantung cukup di lantai terbawah (hal. 399-400)
    const larVoid = i === top ? 'larj' : 'lar';            // lantai teratas: LAR void jendela 1×1 untuk meredam cahaya LMB

    // 1) ruang void: kotak bersekat di sekeliling void; bila sisa samping < 1,2 m sekat dibuat selebar lantai
    const vz0 = Math.max(F.y, vy - 0.4), vz1 = Math.min(F.y + F.h, vy + vh + 0.4);
    const atFront = vz0 <= Y0 + 0.01, atBack = vz1 >= Y1 - 0.01;
    let bx0 = Math.max(F.x, vx - 0.6), bx1 = Math.min(F.x + F.w, vx + vw + 0.6);
    if (bx0 - X0 < 1.2) bx0 = F.x;
    if (X1 - bx1 < 1.2) bx1 = F.x + F.w;
    const boxMode = bx0 > F.x || bx1 < F.x + F.w;         // ada lorong jalur di samping ruang void
    const vbox = { x: bx0, y: vz0, w: bx1 - bx0, h: vz1 - vz0 };
    add('void', vx, vy, vw, vh);
    const edges = [];
    if (!atFront) { wall(bx0, vz0, bx1, vz0, jenis); edges.push({ y: vz0, d: -1 }); }
    if (!atBack) { wall(bx0, vz1, bx1, vz1, jenis); edges.push({ y: vz1, d: 1 }); }
    if (bx0 > F.x) wall(bx0, vz0, bx0, vz1, jenis);
    if (bx1 < F.x + F.w) wall(bx1, vz0, bx1, vz1, jenis);
    edges.forEach(({ y, d }) => {
      add(larVoid, vcx - 0.5, y - 0.075, 1, 0.15);
      const lip = d > 0 ? vy + vh + 0.15 : vy - 0.15;
      tw('twtarik', vx + vw * 0.25, lip, { role: 'void' });   // tarik LAR void di bibir void
      tw('twtarik', vx + vw * 0.75, lip, { role: 'void' });
      tw('twtarik', vcx + 0.3, y, { role: 'jalur' });            // tarik jalur di kusen LAR void (rantai lewat bukaan)
    });

    // 2) ruang jalur & blok inap di depan dan/atau belakang ruang void
    const regions = [];
    if (!atFront) regions.push({ a: Y0, b: vz0, ent: 'bottom' });
    if (!atBack) regions.push({ a: vz1, b: Y1, ent: 'top' });
    const bands = [];
    regions.forEach(rg => {
      const depth = rg.b - rg.a, jd = depth >= JALUR + 1.5 ? JALUR : depth >= 2.7 ? 1.2 : depth;
      const ja = rg.ent === 'top' ? rg.a : rg.b - jd, jb = rg.ent === 'top' ? rg.a + jd : rg.b;
      bands.push([ja, jb]);
      rg.block = depth - jd >= 1.5 ? (rg.ent === 'top' ? { y0: jb, y1: rg.b, ent: 'top' } : { y0: rg.a, y1: ja, ent: 'bottom' }) : null;
    });
    // ruang jalur diberi sirip juga (pemilik: jalur paling lama ditempati burung karena remang) + tweeter inap jarang
    if (boxMode && bands.length) {
      const ja = Math.max(Y0, Math.min(vz0, ...bands.map(b => b[0]))), jb = Math.min(Y1, Math.max(vz1, ...bands.map(b => b[1])));
      add('jalur', X0, ja, X1 - X0, jb - ja, { gap: RULES.siripJarak });
    } else bands.forEach(([a, b]) => add('jalur', X0, a, X1 - X0, b - a, { gap: RULES.siripJarak }));
    bands.forEach(([a, b]) => {
      for (const d of [-1, 1]) for (let x = vcx + d * 4; x > X0 + 0.2 && x < X1 - 0.2; x += d * 4) tw('twtarik', x, (a + b) / 2, { role: 'jalur' });
      if (b - a >= 1) for (let x = X0 + 0.8; x < X1 - 0.5; x += 1.6) { if (Math.abs(x - vcx) > 0.9) tw('twinap', x, Math.max(a + 0.3, (a + b) / 2 - 0.45)); }
    });

    // 3) ruang inap per blok: sekat + LAR pintu per ruang, sirip, tweeter inap & tarik
    // lebar ruang ≤ 4 m (pemilik: ruang inap jangan lebih besar dari 4×4) — gedung lebar otomatis lebih banyak ruang
    const nRoom = Math.max(1, Math.min(Math.floor((F.w - 2 * M) / RULES.inapLebarMin),
      Math.max(RULES.jumlahInap(F.w), Math.ceil((F.w - 2 * M) / RULES.inapMaks))));
    const rw = (F.w - 2 * M) / nRoom, pola = RULES.twinapPola(rw - 0.12);
    regions.forEach(rg => {
      const bk = rg.block; if (!bk) return;
      const yE = bk.ent === 'top' ? bk.y0 : bk.y1, into = bk.ent === 'top' ? 1 : -1;
      const ry0 = bk.y0 + (bk.ent === 'top' ? 0.06 : 0), ry1 = bk.y1 - (bk.ent === 'bottom' ? 0.06 : 0);
      const back = bk.ent === 'top' ? ry1 : ry0, depth = Math.abs(back - yE);
      wall(F.x, yE, F.x + F.w, yE, jenis);
      for (let k = 0; k < nRoom; k++) {
        const x0 = X0 + k * rw, x1 = x0 + rw, xc = x0 + rw / 2;
        if (k > 0) wall(x0, bk.y0 <= Y0 + 0.01 ? F.y : bk.y0, x0, bk.y1 >= Y1 - 0.01 ? F.y + F.h : bk.y1, jenis);   // sekat antar ruang sampai dinding luar
        const room = add('inap', x0 + 0.06, ry0, rw - 0.12, ry1 - ry0, { gap: RULES.siripJarak });
        add('lar', xc - 0.5, yE - 0.075, 1, 0.15);
        tw('twtarik', xc - 0.3, yE, { role: 'lar' });                          // di kusen LAR inap (rantai tidak menembus sekat)
        const cx = xc < F.x + F.w / 2 ? x0 + 0.3 : x1 - 0.3;                   // pojok belakang terjauh
        tw('twtarik', cx, back - into * 0.25, { role: 'inap' });
        const segs = Math.ceil((depth + 0.05) / 4.2);                           // tambahan agar jarak antar tarik ≤ 5 m
        for (let q = 1; q < segs; q++) tw('twtarik', cx, back - into * (0.25 + (q * (depth - 0.25)) / segs), { role: 'inap' });
        twinapPattern(room, 'x', bk.ent).forEach(p => tw('twinap', p.x, p.y));   // menghadap LAR (arah otomatis)
      }
    });

    // 4) lantai teratas tanpa menara: LMB 70×50 cm di dinding luar + tarik LMB (menghadap keluar) + hexagonal di atasnya
    if (i === top && !needMenara) {
      const two = RULES.lmbBesarJika(m.w, m.h);
      const lmb = (x, y, w, h, tx, ty) => { add('lmb', x, y, w, h, { tcm: 50, lmbTw: { a: 2, s: 4, b: 0 } }); tw('twtarik', tx, ty, { role: 'lmb' }); const hx = add('hexa', x, y, 0.44, 0.44); snapHexa(hx, m, { ...fl, items }); };
      const touch = { depan: atFront, belakang: atBack, kiri: vx <= X0 + 0.01, kanan: vx + vw >= X1 - 0.01 };
      const place = f => {                                                      // f = posisi relatif sepanjang void
        const py = vy + vh * f, px = vx + vw * f;
        if (side === 'kiri') touch.kiri ? lmb(F.x, py - 0.35, 0.2, 0.7, F.x + 0.45, py + 0.6) : lmb(vx - 0.1, py - 0.35, 0.2, 0.7, vx + 0.35, py + 0.6);
        else if (side === 'kanan') touch.kanan ? lmb(F.x + F.w - 0.2, py - 0.35, 0.2, 0.7, F.x + F.w - 0.45, py + 0.6) : lmb(vx + vw - 0.1, py - 0.35, 0.2, 0.7, vx + vw - 0.35, py + 0.6);
        else if (side === 'belakang') touch.belakang ? lmb(px - 0.35, F.y + F.h - 0.2, 0.7, 0.2, px + 0.6, F.y + F.h - 0.45) : lmb(px - 0.35, vy + vh - 0.1, 0.7, 0.2, px + 0.6, vy + vh - 0.35);
        else touch.depan ? lmb(px - 0.35, F.y, 0.7, 0.2, px + 0.6, F.y + 0.45) : lmb(px - 0.35, vy - 0.1, 0.7, 0.2, px + 0.6, vy + 0.35);
      };
      if (two) { place(0.25); place(0.75); } else place(0.5);                 // RBW besar: 2 LMB di dinding yang sama
    }

    // 5) ventilasi pipa 4" di dua dinding samping (tidak di sisi yang menempel ruang void; lembab → tiap 2 m)
    for (let y = Y0 + 0.5; y < Y1 - 0.2; y += ventStep) {
      for (const left of [true, false]) {
        if (y > vz0 - 0.2 && y < vz1 + 0.2 && (left ? bx0 <= F.x + 0.01 : bx1 >= F.x + F.w - 0.01)) continue;
        if (items.some(z => z.t === 'lmb' && Math.abs(z.y + z.h / 2 - y) < 0.6 && (left ? z.x < F.x + 0.5 : z.x > F.x + F.w - 0.5))) continue;
        add('vent', left ? F.x : F.x + F.w - 0.3, y - 0.075, 0.3, 0.15);
      }
    }

    // 6) tangga (LAL) di ruang jalur: tidak di ruang void dan harus berada di bawah lantai atasnya
    if (i < top) {
      const up = rects[i + 1], inUp = r => r.x >= up.x - 0.01 && r.y >= up.y - 0.01 && r.x + r.w <= up.x + up.w + 0.01 && r.y + r.h <= up.y + up.h + 0.01;
      const cands = bands.flatMap(([a, b]) => { const th = Math.min(2.5, b - a - 0.3); return th >= 1.2 ? [{ x: X1 - 1.05, y: a + 0.15, w: 1, h: th }, { x: X0 + 0.05, y: a + 0.15, w: 1, h: th }] : []; });
      const T = cands.find(r => ovArea(r, vbox) < 0.01 && inUp(r));
      if (T) add('tangga', T.x, T.y, T.w, T.h);
    }

    // 7) lantai dasar: ruang audio + pintu di sisi depan, kolam di sudut di bawah ventilasi
    if (i === 0) {
      const free = r => !items.some(z => ['void', 'tangga', 'kolam', 'audio'].includes(z.t) && ovArea(r, z) > 0.01) && ovArea(r, vbox) < 0.01;
      const freeA = r => free(r) && !items.some(z => z.t === 'inap' && ovArea(r, z) > 0.01);   // ruang audio tidak boleh di dalam ruang inap
      const cand = [{ x: X0, y: Y0, w: 1.5, h: 2 }, { x: X1 - 1.5, y: Y0, w: 1.5, h: 2 }]
        .concat(bands.map(([a, b]) => ({ x: X0, y: a + 0.1, w: 1.5, h: Math.min(2, b - a - 0.2) })).filter(r => r.h >= 1.4));
      const A = F.w >= 3.4 ? cand.find(freeA) : null;
      if (A) {
        add('audio', A.x, A.y, A.w, A.h);
        if (A.x + A.w < F.x + F.w - 0.4) wall(A.x + A.w, A.y, A.x + A.w, A.y + A.h, 'penuh');
        if (A.x > F.x + 0.4) wall(A.x, A.y, A.x, A.y + A.h, 'penuh');
        wall(A.x, A.y + A.h, A.x + A.w, A.y + A.h, 'penuh');
        if (A.y <= Y0 + 0.01) add('pintu', A.x + 0.3, F.y, 0.9, 0.15);                         // pintu luar di sisi depan
        else add('pintu', A.x < F.x + F.w / 2 ? F.x : F.x + F.w - 0.15, A.y + 0.5, 0.15, 0.9);
        add('pintu', A.x + 0.3, A.y + A.h - 0.075, 0.9, 0.15);                                 // pintu dari ruang audio ke dalam
      }
      const kolamN = ans.rh === 'lembab' ? 1 : ans.rh === 'kering' ? Math.max(2, Math.ceil((F.w * F.h) / 35)) : Math.max(1, Math.ceil(F.w * F.h * RULES.kolamPerM2));
      const slots = [];
      bands.forEach(([a, b]) => { const h = Math.min(2, b - a - 0.4); if (h >= 1) slots.push({ x: X0 + 0.3, y: a + 0.2, w: 1, h }, { x: X1 - 1.3, y: a + 0.2, w: 1, h }); });
      items.filter(z => z.t === 'inap').forEach(r => {
        const y = r.y + r.h / 2 - 1, h = Math.min(2, r.h - 0.6); if (h < 1) return;
        if (r.x <= X0 + 0.1) slots.push({ x: X0 + 0.3, y, w: 1, h });
        if (r.x + r.w >= X1 - 0.1) slots.push({ x: X1 - 1.3, y, w: 1, h });
      });
      let placed = 0;
      for (const sl of slots) { if (placed >= kolamN) break; if (free(sl)) { add('kolam', sl.x, sl.y, sl.w, sl.h); placed++; } }
    }
    // 8) ventilasi silang di dinding depan/belakang bila dinding samping tidak cukup (lantai kecil)
    const needV = RULES.ventPerLantai(F.w, F.h) * (ans.rh === 'lembab' ? 0.5 : 1);
    if (items.filter(z => z.t === 'vent').length < needV * 0.8) {
      for (const [yy, isFront] of [[F.y, true], [F.y + F.h - 0.3, false]]) {
        if (isFront ? atFront : atBack) continue;                                  // dinding yang menempel ruang void
        for (let x = X0 + 0.6; x < X1 - 0.5; x += ventStep) {
          const near = items.some(z => ['lmb', 'pintu', 'audio'].includes(z.t) && x > z.x - 0.5 && x < z.x + z.w + 0.5 && Math.abs(z.y + (isFront ? 0 : z.h) - (isFront ? F.y : F.y + F.h)) < 0.6);
          if (!near) add('vent', x - 0.075, yy, 0.15, 0.3);
        }
      }
    }
    fl.items = items; fl.walls = walls;
    if (i === top) info = { nRoom, pola, atFront, atBack };
  });

  // menara (gedung < 10 m): lantai sendiri tepat di atas void — LMB di dindingnya menghadap arah datang burung, tarik LMB
  // di bibirnya, dan tweeter hexagonal (suara panggil) mepet di atas LMB. RBW besar: + 1 LMB siku.
  if (onlyFloor < 0 || onlyFloor >= top) {
    if (!needMenara) { if (onlyFloor < 0) delete m.menara; }
    else {
      const T = rects[top], mw = r2(Math.min(T.w, Math.max(vw, 2))), mh = r2(Math.min(T.h, Math.max(vh, 2)));
      let fx = clamp(vcx - mw / 2, T.x, T.x + T.w - mw), fy = clamp(vmid - mh / 2, T.y, T.y + T.h - mh);
      if (fx - T.x < 0.3) fx = T.x; else if (T.x + T.w - fx - mw < 0.3) fx = T.x + T.w - mw;   // hampir menempel → rata dinding luar
      if (fy - T.y < 0.3) fy = T.y; else if (T.y + T.h - fy - mh < 0.3) fy = T.y + T.h - mh;
      fx = r2(fx); fy = r2(fy);
      const items = [];
      const put = (t, x, y, w, h, ex = {}) => items.push({ id: uid(), t, x: r2(x), y: r2(y), w: r2(w), h: r2(h), ...ex });
      const lmbOn = s => {
        const cx = fx + mw / 2, cy = fy + mh / 2;
        const [x, y, w, h, nx, ny] = { depan: [cx - 0.35, fy, 0.7, 0.2, 0, 1], belakang: [cx - 0.35, fy + mh - 0.2, 0.7, 0.2, 0, -1], kiri: [fx, cy - 0.35, 0.2, 0.7, 1, 0], kanan: [fx + mw - 0.2, cy - 0.35, 0.2, 0.7, -1, 0] }[s];
        const wx = x + w / 2 - nx * 0.1, wy = y + h / 2 - ny * 0.1;   // titik di garis dinding menara; (nx, ny) = arah ke dalam
        put('lmb', x, y, w, h, { tcm: 50, lmbTw: { a: 2, s: 4, b: 0 } });
        put('twtarik', wx + nx * 0.45 + (ny ? 0.6 : 0) - TW / 2, wy + ny * 0.45 + (nx ? 0.6 : 0) - TW / 2, TW, TW, { role: 'lmb' });
        put('hexa', wx + nx * 0.42 - 0.22, wy + ny * 0.42 - 0.22, 0.44, 0.44);
      };
      lmbOn(side);
      if (RULES.lmbBesarJika(m.w, m.h)) lmbOn(side === 'kiri' || side === 'kanan' ? 'depan' : 'kanan');
      m.menara = { name: 'Menara', menara: true, fx, fy, fw: mw, fh: mh, ht: tinggiMenara, items, walls: [] };
    }
  }

  if (!info) return { notes: [] };
  const tempat = mid ? 'di tengah' : side === 'belakang' ? 'di sisi belakang' : side === 'kiri' ? 'di sisi kiri' : side === 'kanan' ? 'di sisi kanan' : 'di sisi depan';
  const T = rects[top], beda = rects.some(r => r.w !== m.w || r.h !== m.h);
  const notes = [
    `Void ${fmt(vw)} × ${fmt(vh)} m ${tempat}, lurus menembus semua lantai.`,
    `LMB 70×50 cm menghadap ${side}${needMenara ? ` pada lantai menara setinggi ±${fmt(tinggiMenara)} m tepat di atas void` : ' di dinding luar'}${RULES.lmbBesarJika(m.w, m.h) && needMenara ? ', ditambah 1 LMB siku' : ''}; tweeter hexagonal (panggil) mepet di atas LMB.`,
    `${info.nRoom} ruang inap per blok dengan LAR pintu 1×2 m; sekat void lantai teratas memakai LAR jendela 1×1 m.`,
    `Tweeter inap pola ${info.pola[0]}-${info.pola[1]}-${info.pola[0]} menghadap LAR; tweeter tarik berantai inap → LAR inap → jalur → LAR void → LMB.`,
    `Sekat terpal penuh (lantai 1 sekat gantung), ventilasi tiap ${fmt(ventStep)} m di dinding samping, kolam di lantai 1.`,
  ];
  if (beda) notes.push(`Ukuran tiap lantai mengikuti pengaturan lantai; lantai teratas ${fmt(T.w)} × ${fmt(T.h)} m.`);
  if (ans.burung === '?') notes.push('Arah datang burung belum diketahui — LMB sementara menghadap depan. Amati arah pulang walet saat sore lalu sesuaikan.');
  return { notes };
}
