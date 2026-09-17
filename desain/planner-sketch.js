// Sketsa gambar tangan: foto sketsa jadi latar transparan per lantai (untuk dijiplak), kalibrasi 2 titik,
// dan konversi otomatis oleh AI (khusus tim, lewat Cloudflare Worker "sketsa-ai") menjadi elemen denah yang bisa direvisi.
import { TYPES, RULES, SKETCH_API, TW } from './planner-data.js';
import { floorRect, snapToWall, clampInto, derive, twinapPattern, inRect, center, isLar } from './planner-geom.js';

const LS_TEAM = 'waletPlanner.teamKey', LS_AI = 'waletPlanner.aiUrl';
const r2 = v => Math.round(v * 100) / 100;
const snap5 = v => Math.round(v * 20) / 20;
const c01 = v => Math.min(1, Math.max(0, +v || 0));
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
let seq = 0;
const uid = () => Math.random().toString(36).slice(2, 7) + (seq++).toString(36);
const OPEN = new Set(['lmb', 'lar', 'larj', 'pintu', 'vent']);
const ZONE = new Set(['void', 'jalur', 'inap', 'audio']);
const isH = w => w.y1 === w.y2 && w.x1 !== w.x2, isV = w => w.x1 === w.x2 && w.y1 !== w.y2;

// Tulisan yang dikenali di sketsa — sama dengan prompt AI di workers/sketsa-ai/src/index.js.
export const LEGENDA = [
  ['LMB', 'Lubang masuk burung (di dinding luar / menara)'],
  ['VOID atau kotak bersilang (X)', 'Lubang terjun antar lantai'],
  ['LAR', 'Pintu antar ruang pada sekat (1 × 2 m)'],
  ['LAR J / LJ', 'LAR jendela (1 × 1 m)'],
  ['INAP / R. INAP / RI', 'Ruang inap bersirip'],
  ['JALUR / TRANSIT', 'Ruang jalur'],
  ['AUDIO / RA', 'Ruang audio'],
  ['KOLAM / K', 'Kolam air'],
  ['TANGGA / TG', 'Tangga'],
  ['PINTU / P', 'Pintu masuk orang'],
  ['V / VENT', 'Ventilasi pipa'],
  ['MENARA / RM', 'Menara (rumah monyet)'],
  ['TI', 'Tweeter inap'],
  ['TT', 'Tweeter tarik'],
  ['Garis tebal / berarsir', 'Sekat walet (terpal)'],
  ['Garis putus-putus', 'Sekat gantung'],
  ['Angka + m (mis. 4 m, 12 m)', 'Ukuran gedung / ruang'],
  ['DEPAN / JALAN', 'Sisi depan gedung'],
];

// ---------- penyimpanan sketsa ----------
// Di luar model (tidak ikut undo & link desain) dan di IndexedDB: foto ratusan KB tidak boleh menghabiskan
// kuota localStorage tempat desain disimpan.
const store = {};
const keyOf = (m, i) => `${m.id}:${i}`;
let dbp = null;
function db() {
  dbp = dbp || new Promise((res, rej) => {
    if (typeof indexedDB === 'undefined') { rej(new Error('IndexedDB tidak tersedia')); return; }
    const rq = indexedDB.open('waletPlanner', 1);
    rq.onupgradeneeded = () => rq.result.createObjectStore('sketsa');
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error);
  });
  return dbp;
}
function tx(mode, fn) {
  return db().then(d => new Promise((res, rej) => {
    const t = d.transaction('sketsa', mode); fn(t.objectStore('sketsa'));
    t.oncomplete = () => res(true); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
  }));
}
const put = (k, v) => tx('readwrite', os => (v ? os.put(v, k) : os.delete(k))).catch(e => console.warn('sketsa tidak tersimpan', e));
export function loadSketches() {
  return tx('readonly', os => {
    const rq = os.openCursor();
    rq.onsuccess = () => { const c = rq.result; if (c) { store[c.key] = c.value; c.continue(); } };
  }).catch(() => false);
}
export const getSketch = (m, i) => (m ? store[keyOf(m, i)] || null : null);
export function setSketch(m, i, sk) {
  const k = keyOf(m, i);
  if (sk) store[k] = sk; else delete store[k];
  put(k, sk || null);
}
// Hanya satu proyek yang tersimpan di perangkat → sketsa proyek lain dibuang.
export function prune(m) {
  Object.keys(store).forEach(k => { if (!k.startsWith(m.id + ':')) { delete store[k]; put(k, null); } });
}
// Lantai `removed` dihapus dari n lantai → sketsa lantai di atasnya turun satu nomor.
export function shiftSketches(m, removed, n) {
  for (let i = removed; i < n; i++) setSketch(m, i, store[keyOf(m, i + 1)] || null);
}
// data: URL → File (untuk dibagikan) / blob: URL pendek (denah digambar ulang tiap gerakan mouse — data URL
// ratusan KB terlalu berat untuk itu).
export function sketchFile(sk) {
  try {
    const [head, b64] = sk.src.split(','), bin = atob(b64), a = new Uint8Array(bin.length);
    for (let k = 0; k < bin.length; k++) a[k] = bin.charCodeAt(k);
    return new File([a], 'sketsa-denah.jpg', { type: (head.match(/data:([^;]+)/) || [])[1] || 'image/jpeg' });
  } catch { return null; }
}
const hrefs = new Map();
export function sketchHref(sk) {
  if (!sk?.src) return '';
  let u = hrefs.get(sk.src);
  if (!u) {
    const f = sketchFile(sk);
    u = f ? URL.createObjectURL(f) : sk.src;
    if (hrefs.size >= 12) { const [k0, u0] = hrefs.entries().next().value; if (u0.startsWith('blob:')) URL.revokeObjectURL(u0); hrefs.delete(k0); }
    hrefs.set(sk.src, u);
  }
  return u;
}

// Kecilkan foto: sisi terpanjang ≤ maxPx, JPEG — cukup tajam untuk tulisan tangan, hemat penyimpanan & token AI.
export function loadImageFile(file, maxPx = 2000) {
  return new Promise((res, rej) => {
    if (!file || !/^image\//.test(file.type)) { rej(new Error('Pilih file gambar (JPG / PNG).')); return; }
    const fr = new FileReader();
    fr.onerror = () => rej(new Error('File tidak bisa dibaca.'));
    fr.onload = () => {
      const img = new Image();
      img.onerror = () => rej(new Error('Format gambar tidak didukung browser ini.'));
      img.onload = () => {
        const k = Math.min(1, maxPx / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.round(img.naturalWidth * k), h = Math.round(img.naturalHeight * k);
        const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
        const c = cv.getContext('2d'); c.fillStyle = '#fff'; c.fillRect(0, 0, w, h); c.drawImage(img, 0, 0, w, h);
        res({ src: cv.toDataURL('image/jpeg', 0.82), iw: w, ih: h, rot: 0, op: 0.55, show: true });
      };
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  });
}

// Letakkan foto utuh di dalam batas lantai (rasio dijaga) — posisi awal sebelum kalibrasi.
// x, y, w, h = kotak foto (setelah diputar `rot`) dalam meter koordinat denah.
export function fitToFloor(sk, F) {
  const ar = (sk.rot || 0) % 180 ? sk.ih / sk.iw : sk.iw / sk.ih;
  let w = F.w, h = w / ar;
  if (h > F.h) { h = F.h; w = h * ar; }
  return { ...sk, x: r2(F.x + (F.w - w) / 2), y: r2(F.y + (F.h - h) / 2), w: r2(w), h: r2(h) };
}
// Kalibrasi 2 titik: p1/p2 = dua sudut berseberangan garis luar gedung pada foto → dipetakan ke sudut batas lantai.
export function calibrate(sk, p1, p2, F) {
  const a = { x: Math.min(p1.x, p2.x), y: Math.min(p1.y, p2.y) }, b = { x: Math.max(p1.x, p2.x), y: Math.max(p1.y, p2.y) };
  const sx = F.w / Math.max(0.05, b.x - a.x), sy = F.h / Math.max(0.05, b.y - a.y);
  return { ...sk, x: r2(F.x - (a.x - sk.x) * sx), y: r2(F.y - (a.y - sk.y) * sy), w: r2(sk.w * sx), h: r2(sk.h * sy) };
}
export const rotate90 = (sk, F) => fitToFloor({ ...sk, rot: ((sk.rot || 0) + 90) % 360 }, F);

// ---------- koordinat hasil AI ----------
// AI memberi koordinat 0..1 terhadap garis luar gedung pada foto + sisi foto yang merupakan "depan".
// Denah planner selalu menaruh sisi depan di atas, jadi hasil diputar sesuai sisi depan tersebut.
export const DEPAN = [['atas', 'Atas foto'], ['bawah', 'Bawah foto'], ['kiri', 'Kiri foto'], ['kanan', 'Kanan foto']];
const ROT = { atas: 0, kanan: 270, bawah: 180, kiri: 90 };
const sideOf = (plan, d) => (own(ROT, d || '') ? d : own(ROT, plan?.depan || '') ? plan.depan : 'atas');
function rotBox(b, d) {
  if (d === 'bawah') return { x: 1 - b.x - b.w, y: 1 - b.y - b.h, w: b.w, h: b.h };
  if (d === 'kiri') return { x: 1 - b.y - b.h, y: b.x, w: b.h, h: b.w };
  if (d === 'kanan') return { x: b.y, y: 1 - b.x - b.w, w: b.h, h: b.w };
  return b;
}
function rotPt(p, d) {
  if (d === 'bawah') return { x: 1 - p.x, y: 1 - p.y };
  if (d === 'kiri') return { x: 1 - p.y, y: p.x };
  if (d === 'kanan') return { x: p.y, y: 1 - p.x };
  return p;
}
// Ukuran yang tertulis di sketsa → lebar (kiri-kanan) & panjang (depan-belakang) setelah diputar.
export function sizeHint(plan, d0) {
  const d = sideOf(plan, d0), hz = +plan?.ukuran?.horizontal_m || 0, vt = +plan?.ukuran?.vertikal_m || 0;
  const [w, h] = d === 'kiri' || d === 'kanan' ? [vt, hz] : [hz, vt];
  return { w: w >= 2 && w <= 40 ? r2(w) : null, h: h >= 2 && h <= 60 ? r2(h) : null };
}
// Posisikan foto sehingga garis luar gedung pada foto tepat menutupi batas lantai.
export function placeByFrame(sk, plan, F, d0) {
  const d = sideOf(plan, d0), fr = plan?.bingkai;
  const x0 = c01(fr?.x0), y0 = c01(fr?.y0), x1 = c01(fr?.x1), y1 = c01(fr?.y1);
  if (!(x1 - x0 > 0.05 && y1 - y0 > 0.05)) return fitToFloor({ ...sk, rot: ROT[d] }, F);
  const b = rotBox({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, d), W = F.w / b.w, H = F.h / b.h;
  return { ...sk, rot: ROT[d], x: r2(F.x - b.x * W), y: r2(F.y - b.y * H), w: r2(W), h: r2(H) };
}

// Sekat segaris yang bersambung — atau terputus oleh celah tempat LAR/pintu — dijadikan satu garis.
function mergeCollinear(walls, opens) {
  for (let again = true; again;) {
    again = false;
    for (let i = 0; i < walls.length && !again; i++) for (let j = i + 1; j < walls.length && !again; j++) {
      const a = walls[i], b = walls[j], h = isH(a) && isH(b);
      if (!h && !(isV(a) && isV(b))) continue;
      const ca = h ? a.y1 : a.x1, cb = h ? b.y1 : b.x1; if (Math.abs(ca - cb) > 0.15) continue;
      const ra = h ? [a.x1, a.x2] : [a.y1, a.y2], rb = h ? [b.x1, b.x2] : [b.y1, b.y2];
      const a0 = Math.min(...ra), a1 = Math.max(...ra), b0 = Math.min(...rb), b1 = Math.max(...rb);
      const c = snap5((ca * (a1 - a0) + cb * (b1 - b0)) / (a1 - a0 + b1 - b0));   // garis yang lebih panjang lebih dipercaya
      const g0 = Math.min(a1, b1), g1 = Math.max(a0, b0), gap = g1 - g0;
      const bridge = gap > 0.05 && gap <= 1.6 && opens.some(o => {
        const p = center(o), along = h ? p.x : p.y, perp = h ? p.y : p.x;
        return along > g0 - 0.1 && along < g1 + 0.1 && Math.abs(perp - c) < 0.45;
      });
      if ((gap <= 0.05 && a.jenis === b.jenis) || bridge) {
        const lo = Math.min(a0, b0), hi = Math.max(a1, b1);
        Object.assign(a, h ? { x1: lo, x2: hi, y1: c, y2: c } : { y1: lo, y2: hi, x1: c, x2: c });
        walls.splice(j, 1); again = true;
      }
    }
  }
}
// Ujung sekat yang berdekatan disambung (sudut L tetap siku); ujung dekat badan sekat lain ditempel (sambungan T).
function tidyWalls(walls, tol = 0.3) {
  const ends = walls.flatMap(w => [[w, 1], [w, 2]]);
  for (let i = 0; i < ends.length; i++) for (let j = i + 1; j < ends.length; j++) {
    const [a, ka] = ends[i], [b, kb] = ends[j]; if (a === b) continue;
    const px = a['x' + ka], py = a['y' + ka], qx = b['x' + kb], qy = b['y' + kb];
    if (Math.hypot(px - qx, py - qy) > tol) continue;
    if (isH(a) && isV(b)) { a['x' + ka] = b.x1; b['y' + kb] = a.y1; }
    else if (isV(a) && isH(b)) { a['y' + ka] = b.y1; b['x' + kb] = a.x1; }
    else if ((isH(a) && isH(b) && a.y1 === b.y1) || (isV(a) && isV(b) && a.x1 === b.x1) || (!isH(a) && !isV(a) && !isH(b) && !isV(b))) {
      const x = snap5((px + qx) / 2), y = snap5((py + qy) / 2);
      a['x' + ka] = b['x' + kb] = x; a['y' + ka] = b['y' + kb] = y;
    }
  }
  for (const [w, k] of ends) for (const o of walls) {
    if (o === w) continue;
    const px = w['x' + k], py = w['y' + k];
    if (isH(o) && isV(w) && px >= Math.min(o.x1, o.x2) - tol && px <= Math.max(o.x1, o.x2) + tol && Math.abs(py - o.y1) <= tol) w['y' + k] = o.y1;
    else if (isV(o) && isH(w) && py >= Math.min(o.y1, o.y2) - tol && py <= Math.max(o.y1, o.y2) + tol && Math.abs(px - o.x1) <= tol) w['x' + k] = o.x1;
  }
}
// Tepi ruang ditempel ke garis sekat / dinding terdekat (≤ 45 cm) agar LAR terbaca sebagai pintu ruang itu.
function snapZone(it, walls, F) {
  const V = [F.x, F.x + F.w].map(c => ({ c, a: F.y, b: F.y + F.h })), H = [F.y, F.y + F.h].map(c => ({ c, a: F.x, b: F.x + F.w }));
  walls.forEach(w => {
    if (isV(w)) V.push({ c: w.x1, a: Math.min(w.y1, w.y2), b: Math.max(w.y1, w.y2) });
    else if (isH(w)) H.push({ c: w.y1, a: Math.min(w.x1, w.x2), b: Math.max(w.x1, w.x2) });
  });
  const pick = (v, list, a, b) => {
    let best = null;
    for (const l of list) {
      const d = Math.abs(l.c - v), ov = Math.min(b, l.b) - Math.max(a, l.a);
      if (d <= 0.45 && ov >= 0.3 * (b - a) && (!best || d < best.d)) best = { c: l.c, d };
    }
    return best ? best.c : v;
  };
  const x0 = pick(it.x, V, it.y, it.y + it.h), x1 = pick(it.x + it.w, V, it.y, it.y + it.h);
  const y0 = pick(it.y, H, it.x, it.x + it.w), y1 = pick(it.y + it.h, H, it.x, it.x + it.w);
  if (x1 - x0 >= 0.3 && y1 - y0 >= 0.3) Object.assign(it, { x: r2(x0), y: r2(y0), w: r2(x1 - x0), h: r2(y1 - y0) });
}

// Hasil AI → sekat & elemen planner di dalam batas lantai. d0 = sisi depan pada foto (default: jawaban AI).
export function aiToFloor(plan, m, fl, d0) {
  const F = floorRect(m, fl), d = sideOf(plan, d0), items = [], walls = [], warn = [];
  const edge = (v, lo, hi) => (Math.abs(v - lo) < 0.4 ? lo : Math.abs(v - hi) < 0.4 ? hi : v);
  const gx = v => edge(snap5(v), F.x, F.x + F.w), gy = v => edge(snap5(v), F.y, F.y + F.h);
  (Array.isArray(plan?.sekat) ? plan.sekat : []).slice(0, 300).forEach(s => {
    const a = rotPt({ x: c01(s?.x1), y: c01(s?.y1) }, d), b = rotPt({ x: c01(s?.x2), y: c01(s?.y2) }, d);
    let x1 = F.x + a.x * F.w, y1 = F.y + a.y * F.h, x2 = F.x + b.x * F.w, y2 = F.y + b.y * F.h;
    const dx = Math.abs(x2 - x1), dy = Math.abs(y2 - y1);
    if (dy < 0.2 * dx) y1 = y2 = (y1 + y2) / 2; else if (dx < 0.2 * dy) x1 = x2 = (x1 + x2) / 2;   // luruskan
    const w = { id: uid(), x1: gx(x1), y1: gy(y1), x2: gx(x2), y2: gy(y2), jenis: s?.gantung ? 'gantung' : 'penuh' };
    if (Math.hypot(w.x2 - w.x1, w.y2 - w.y1) >= 0.4) walls.push(w);
  });
  (Array.isArray(plan?.elemen) ? plan.elemen : []).slice(0, 600).forEach(e => {
    const t = typeof e?.jenis === 'string' ? e.jenis : '', T = own(TYPES, t) ? TYPES[t] : null;
    if (!T || T.kind === 'wall') { warn.push(`Tulisan "${String(e?.label || t || '?').slice(0, 30)}" tidak dikenali — tambahkan manual bila perlu.`); return; }
    const r0 = rotBox({ x: c01(e.x), y: c01(e.y), w: c01(e.w), h: c01(e.h) }, d);
    const r = { x: F.x + r0.x * F.w, y: F.y + r0.y * F.h, w: r0.w * F.w, h: r0.h * F.h }, cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    let it;
    if (t === 'twinap' || t === 'twtarik') it = { t, x: cx - TW / 2, y: cy - TW / 2, w: TW, h: TW };
    else if (OPEN.has(t)) {
      const hz = r.w >= r.h, L = t === 'lmb' ? 0.7 : t === 'vent' ? 0.3 : t === 'pintu' ? 0.9 : 1;
      it = { t, x: cx - (hz ? L / 2 : 0.075), y: cy - (hz ? 0.075 : L / 2), w: hz ? L : 0.15, h: hz ? 0.15 : L };
    } else it = { t, x: snap5(r.x), y: snap5(r.y), w: Math.max(0.3, snap5(r.w)), h: Math.max(0.3, snap5(r.h)) };
    it.id = uid();
    if (t === 'inap') it.gap = RULES.siripJarak;
    if (t === 'lmb') it.tcm = 50;
    if (t === 'menara') it.mt = 2.5;
    items.push(clampInto(it, F));
  });
  mergeCollinear(walls, items.filter(it => it.t === 'lar' || it.t === 'larj' || it.t === 'pintu'));
  tidyWalls(walls);
  const kept = walls.filter(w => {   // garis di atas dinding luar bukan sekat
    const ext = isH(w) ? Math.abs(w.y1 - F.y) < 0.05 || Math.abs(w.y1 - F.y - F.h) < 0.05 : isV(w) ? Math.abs(w.x1 - F.x) < 0.05 || Math.abs(w.x1 - F.x - F.w) < 0.05 : false;
    return !ext && Math.hypot(w.x2 - w.x1, w.y2 - w.y1) >= 0.4;
  });
  items.filter(it => ZONE.has(it.t)).forEach(it => snapZone(it, kept, F));
  const tmp = { ...fl, items, walls: kept };
  items.forEach(it => {
    if (OPEN.has(it.t) && !snapToWall(it, m, tmp) && isLar(it.t)) warn.push(`${TYPES[it.t].name} di sekitar X ${r2(it.x)} m, Y ${r2(it.y)} m tidak menempel di sekat — geser ke garis sekat.`);
  });
  (Array.isArray(plan?.catatan) ? plan.catatan : []).slice(0, 8).forEach(c => warn.push(`AI: ${String(c).slice(0, 200)}`));
  return { items, walls: kept, warn };
}
// Tweeter inap pola standar (2-1-2 / 3-2-3 / 4-3-4) untuk ruang inap tanpa TI — atau semua ruang bila `semua`.
export function lengkapiTwinap(m, fl, semua = false) {
  const d = derive(m, fl); let n = 0;
  d.rooms.forEach(room => {
    const inside = z => z.t === 'twinap' && inRect(center(z), room);
    if (semua) fl.items = fl.items.filter(z => !inside(z));
    else if (fl.items.some(inside)) return;
    const o = d.orient.get(room.id), e = (d.entr.get(room.id) || [])[0];
    twinapPattern(room, o, e ? e.side : o === 'x' ? 'top' : 'left').forEach(p => {
      fl.items.push({ id: uid(), t: 'twinap', x: r2(p.x - TW / 2), y: r2(p.y - TW / 2), w: TW, h: TW }); n++;
    });
  });
  return n;
}
export function summarize(items, walls) {
  const n = {}; items.forEach(it => { n[it.t] = (n[it.t] || 0) + 1; });
  const parts = Object.entries(n).map(([t, k]) => `${k} ${TYPES[t].name.toLowerCase()}`);
  if (walls.length) parts.push(`${walls.length} sekat`);
  return parts.join(', ') || 'tidak ada elemen yang terbaca';
}

// ---------- layanan AI (Cloudflare Worker, khusus tim) ----------
export const teamKey = () => { try { return localStorage.getItem(LS_TEAM) || ''; } catch { return ''; } };
export function aiUrl() { let u = ''; try { u = localStorage.getItem(LS_AI) || ''; } catch {} return (u || SKETCH_API || '').trim().replace(/\/+$/, ''); }
export function setTeam(key, url) {
  try {
    if (key) localStorage.setItem(LS_TEAM, key); else localStorage.removeItem(LS_TEAM);
    if (url && url !== SKETCH_API) localStorage.setItem(LS_AI, url); else localStorage.removeItem(LS_AI);
  } catch {}
}
async function post(url, key, path, body, signal, ms) {
  if (!url) throw new Error('Alamat layanan AI belum diatur — isi lewat tombol "Kode tim".');
  if (!key) throw new Error('Kode tim belum diisi.');
  const ctrl = new AbortController(), stop = () => ctrl.abort(), tm = setTimeout(stop, ms);
  signal?.addEventListener('abort', stop);
  try {
    const r = await fetch(url + path, { method: 'POST', signal: ctrl.signal, headers: { 'Content-Type': 'application/json', 'X-Team-Key': key }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) throw new Error(j.error || `Layanan AI menolak permintaan (HTTP ${r.status}).`);
    return j;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(signal?.aborted ? 'Dibatalkan.' : 'Layanan AI tidak menjawab — coba lagi.');
    if (e instanceof TypeError) throw new Error('Tidak bisa terhubung ke layanan AI — cek alamat Worker dan koneksi internet.');
    throw e;
  } finally { clearTimeout(tm); signal?.removeEventListener('abort', stop); }
}
export const checkTeam = (url, key) => post(String(url || '').trim().replace(/\/+$/, ''), key, '/cek', {}, null, 20000);
export const requestAI = (sk, info, signal) =>
  post(aiUrl(), teamKey(), '/konversi', { image: sk.src.split(',')[1], media_type: 'image/jpeg', ...info }, signal, 240000);
// Perkiraan biaya Claude Opus 5 (US$5 / 1 juta token masuk, US$25 / 1 juta token keluar).
export const costUSD = u => ((+u?.input || 0) * 5 + (+u?.output || 0) * 25) / 1e6;
