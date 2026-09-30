// Analisis lokasi (site analysis) untuk tab "Presentasi": pengguna menempel titik Google Maps (link atau koordinat),
// lalu data lingkungan diambil dari sumber TERBUKA GRATIS —
//   • OpenStreetMap (Overpass API): jalan, sungai, tutupan lahan, bangunan, sekolah/pasar/ibadah/industri/rel, permukiman terdekat
//   • Open-Meteo: elevasi 7×7 titik + 12 bulan angin, suhu, kelembapan & curah hujan (reanalisis ERA5)
// dihitung jadi 12 panel ala diagram arsitek (lokasi, bangunan, jalan/bising, matahari, angin, air & hujan, topografi,
// suhu & kelembapan, ekologi, sumber bising & aktivitas, kendala & peluang, skor kelayakan) + implikasi untuk desain RBW.
// Ringkasan (m.lokasi.amb) sengaja kecil & berupa angka bulat supaya ikut tersimpan di link desain.
import { ARAH8, RULES, SUARA } from './planner-data.js?v=20260930d';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const f1 = n => Math.round(n * 10) / 10;
const d1 = n => String(f1(n)).replace('.', ',');
const fmt = n => (+n).toLocaleString('id-ID');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const RAD = Math.PI / 180;
const arahNama = b => ARAH8.reduce((x, a) => (Math.abs(((b - a[0] + 540) % 360) - 180) > Math.abs(((b - x[0] + 540) % 360) - 180) ? x : a))[1];
const BLN = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
const BLN_N = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const HARI_BLN = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const SEM1 = [10, 11, 0, 1, 2, 3];   // Nov–Apr
const jrk = d => (d >= 1000 ? `${d1(d / 1000)} km` : `${Math.round(d)} m`);
// sisi gedung (depan/kanan/belakang/kiri) yang menghadap arah kompas b, bila depan gedung menghadap `hadap`
const sisiDari = (b, hadap) => { const rel = (((b - hadap) % 360) + 360) % 360; return rel < 45 || rel >= 315 ? 'depan' : rel < 135 ? 'kanan' : rel < 225 ? 'belakang' : 'kiri'; };
const brg = (x, y) => (Math.atan2(x, y) / RAD + 360) % 360;   // x = timur, y = utara → bearing kompas
const interp = (x, tab) => { if (x <= tab[0][0]) return tab[0][1]; for (let i = 1; i < tab.length; i++) if (x <= tab[i][0]) { const [x0, y0] = tab[i - 1], [x1, y1] = tab[i]; return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0); } return tab[tab.length - 1][1]; };

// ---------- titik dari link Google Maps / koordinat ----------
export function parseTitik(txt) {
  const s = String(txt || '').trim();
  let mm = s.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/)
    || s.match(/[?&](?:q|ll|query|center|destination)=(-?\d+\.\d+)(?:%2C|,)(-?\d+\.\d+)/i)
    || s.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
  if (!mm) {
    const t = s.replace(/[()°]/g, ' ').replace(/\s+/g, ' ').trim();
    let m2 = t.match(/^(-?\d{1,2}\.\d+)[,;\s]+(-?\d{1,3}\.\d+)$/);            // -6.2334, 106.8342
    if (!m2) { const m3 = t.match(/^(-?\d{1,2},\d+)[;\s]+(-?\d{1,3},\d+)$/); if (m3) m2 = [0, m3[1].replace(',', '.'), m3[2].replace(',', '.')]; }   // -6,2334 106,8342
    mm = m2;
  }
  if (!mm) return null;
  const la = +mm[1], lo = +mm[2];
  if (!Number.isFinite(la) || !Number.isFinite(lo) || Math.abs(la) > 80 || Math.abs(lo) > 180) return null;
  return { la: Math.round(la * 1e5) / 1e5, lo: Math.round(lo * 1e5) / 1e5 };
}

// ---------- geometri (meter; x = timur, y = utara; titik lokasi = 0,0) ----------
const keMeter = (la0, lo0, lat, lon) => [(lon - lo0) * 111320 * Math.cos(la0 * RAD), (lat - la0) * 110540];
function jarakGaris(pts) {   // jarak & arah titik terdekat dari (0,0) ke polyline
  let bd = Infinity, bx = 0, by = 0;
  if (pts.length === 1) { bd = Math.hypot(pts[0][0], pts[0][1]); bx = pts[0][0]; by = pts[0][1]; }
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i], [ex, ey] = pts[i + 1], dx = ex - ax, dy = ey - ay, L2 = dx * dx + dy * dy;
    const t = L2 ? clamp(-(ax * dx + ay * dy) / L2, 0, 1) : 0, px = ax + t * dx, py = ay + t * dy, d = Math.hypot(px, py);
    if (d < bd) { bd = d; bx = px; by = py; }
  }
  return { d: bd, b: brg(bx, by) };
}
const luasPoli = pts => { let A = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; A += p[0] * q[1] - q[0] * p[1]; } return Math.abs(A) / 2; };
const dalamPoli = (x, y, pts) => { let d = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const [xi, yi] = pts[i], [xj, yj] = pts[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) d = !d; } return d; };

// ---------- pengambilan data (tiap sumber terpisah; gagal satu tidak menggagalkan lainnya) ----------
const ambil = async (url, opt, timeout = 40000) => {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), timeout);
  try { const r = await fetch(url, { ...opt, signal: ac.signal }); if (!r.ok) throw new Error('HTTP ' + r.status); return await r.json(); }
  finally { clearTimeout(t); }
};
// Beberapa cermin Overpass dicoba berurutan — jaringan/waktu tertentu menolak salah satunya (406/429/504); batas total ±100 detik.
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
const buruk = new Map();   // url → waktu sampai server yang menolak (406/429/timeout) dicoba lagi
async function overpass(q) {
  const t0 = Date.now(); let terakhir = null;
  for (let putaran = 0; putaran < 2; putaran++) {
    for (const url of OVERPASS.filter(u => (buruk.get(u) || 0) < Date.now())) {
      if (Date.now() - t0 > 75000) throw terakhir || new Error('batas waktu Overpass');
      try {
        const j = await ambil(url, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }, 32000);
        if (j.remark && /runtime error|timed out|out of memory/i.test(j.remark)) throw new Error(j.remark);
        OVERPASS.unshift(...OVERPASS.splice(OVERPASS.indexOf(url), 1));   // server yang berhasil dicoba paling awal lain kali
        return j;
      } catch (e) {
        terakhir = e; console.warn('overpass gagal:', url, e?.message || e);
        buruk.set(url, Date.now() + (/HTTP (403|406|429)/.test(String(e?.message)) ? 300000 : 60000));
      }
    }
  }
  throw terakhir || new Error('semua server Overpass sedang menolak — coba lagi beberapa menit');
}

async function osm(la, lo) { return parseOsm(await overpass(`[out:json][timeout:40];(way(around:500,${la},${lo})[highway];way(around:1000,${la},${lo})[landuse];way(around:1000,${la},${lo})[natural];way(around:1000,${la},${lo})[waterway];);out geom 500;`), la, lo); }
export function parseOsm(j, la, lo) {
  const KELAS = { motorway: 1, trunk: 1, primary: 1, motorway_link: 1, trunk_link: 1, primary_link: 1, secondary: 2, secondary_link: 2, tertiary: 3, tertiary_link: 3, unclassified: 3, road: 3, residential: 4, living_street: 4, service: 4, track: 4 };
  const rd = [], areas = { air: 0, sawah: 0, hutan: 0, bangun: 0 };
  let sg = null;
  (j.elements || []).forEach(e => {
    if (!Array.isArray(e.geometry) || e.geometry.length < 2) return;
    const pts = e.geometry.map(g => keMeter(la, lo, g.lat, g.lon));
    const tg = e.tags || {};
    if (tg.highway && KELAS[tg.highway]) {
      const jg = jarakGaris(pts), langkah = Math.max(1, Math.ceil(pts.length / 10));
      rd.push({ c: KELAS[tg.highway], d: Math.round(jg.d), b: Math.round(jg.b), ...(tg.name ? { n: String(tg.name).slice(0, 26) } : {}), p: pts.filter((_, i) => i % langkah === 0 || i === pts.length - 1).map(p => [Math.round(p[0] / 5) * 5, Math.round(p[1] / 5) * 5]) });
    } else if (tg.waterway && ['river', 'stream', 'canal'].includes(tg.waterway)) {
      const jg = jarakGaris(pts), d = Math.round(jg.d);
      if (!sg || d < sg.d) sg = { d, b: Math.round(jg.b), ...(tg.name ? { n: String(tg.name).slice(0, 26) } : {}) };
    } else {
      const kat = tg.natural === 'water' || tg.landuse === 'basin' || tg.landuse === 'reservoir' || tg.natural === 'wetland' ? 'air'
        : tg.landuse === 'forest' || tg.natural === 'wood' || tg.natural === 'scrub' ? 'hutan'
        : ['farmland', 'orchard', 'meadow', 'farmyard', 'greenhouse_horticulture'].includes(tg.landuse) || tg.natural === 'grassland' ? 'sawah'
        : ['residential', 'industrial', 'commercial', 'retail'].includes(tg.landuse) ? 'bangun' : null;
      if (kat) areas[kat] += luasPoli(pts);
    }
  });
  rd.sort((a, b) => a.c - b.c || a.d - b.d);
  const dekat = rd.slice().sort((a, b) => a.d - b.d);   // jalan penting DAN jalan terdekat sama-sama disimpan
  const pilih = [...new Set([...rd.slice(0, 6), ...dekat.slice(0, 6)])].slice(0, 10);
  const CIRC = Math.PI * 1e6;
  const ek = Object.fromEntries(Object.entries(areas).map(([k, v]) => [k, clamp(Math.round((100 * v) / CIRC), 0, 100)]));
  if (sg) ek.sg = sg;
  return { rd: pilih, ek };
}

// Bangunan dalam radius 260 m → grid 25×25 (sel 20 m; baris 0 = utara; bit c = kolom c) + statistik.
async function bangunan(la, lo) { return parseBangunan(await overpass(`[out:json][timeout:60];way(around:260,${la},${lo})[building];out tags geom 700;`), la, lo); }
export function parseBangunan(j, la, lo) {
  const R = 260, N = 25, S = 20, LIM = 700;
  const els = (j.elements || []).filter(e => Array.isArray(e.geometry) && e.geometry.length >= 3);
  const rows = Array(N).fill(0);
  const tandai = (x, y) => { const c = Math.floor((x + 250) / S), r = Math.floor((250 - y) / S); if (r >= 0 && r < N && c >= 0 && c < N) rows[r] |= 1 << c; };
  let luas = 0, dk = Infinity, lv = 0, t3 = 0, dt = Infinity;
  for (const e of els) {
    const pts = e.geometry.map(g => keMeter(la, lo, g.lat, g.lon)), tg = e.tags || {};
    luas += luasPoli(pts);
    const jd = dalamPoli(0, 0, pts) ? 0 : jarakGaris(pts.concat([pts[0]])).d;
    dk = Math.min(dk, jd);
    const lvl = Math.round(+tg['building:levels']) || (+tg.height ? Math.round(+tg.height / 3.2) : 0);
    if (lvl >= 3) { t3++; dt = Math.min(dt, jd); }
    lv = Math.max(lv, lvl);
    pts.forEach(p => tandai(p[0], p[1]));
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    for (let x = Math.floor(Math.min(...xs) / 10) * 10 + 5; x <= Math.max(...xs) + 5; x += 10) for (let y = Math.floor(Math.min(...ys) / 10) * 10 + 5; y <= Math.max(...ys) + 5; y += 10) if (dalamPoli(x, y, pts)) tandai(x, y);
  }
  return { bg: { n: els.length, p: Math.round((100 * luas) / (Math.PI * R * R)), dk: Number.isFinite(dk) ? Math.round(dk) : null, lv, t3, ...(Number.isFinite(dt) ? { dt: Math.round(dt) } : {}), ...((j.elements || []).length >= LIM ? { c: 1 } : {}), g: rows.map(v => v.toString(36)) } };
}

// Fasilitas penting sekitar (sumber bising / aktivitas) + permukiman terdekat.
export const KAT_NAMA = { pd: 'Sekolah / kampus', ms: 'Masjid / musala', ib: 'Tempat ibadah lain', ps: 'Pasar', ks: 'Rumah sakit', sp: 'SPBU', hb: 'Hiburan malam', in: 'Pabrik / industri', rl: 'Rel kereta', bd: 'Bandara / helipad' };
const KAT_WARNA = { pd: '#5c8fbf', ms: '#6f9f6b', ib: '#8d7fb8', ps: '#c98c3f', ks: '#c15b5b', sp: '#8a8a8a', hb: '#b05fa0', in: '#7a6a5a', rl: '#4a5a6a', bd: '#3f7f9f' };
function kodeKat(tg) {
  const a = tg.amenity;
  if (['school', 'kindergarten', 'college', 'university'].includes(a)) return 'pd';
  if (a === 'place_of_worship') return tg.religion === 'muslim' ? 'ms' : 'ib';
  if (a === 'marketplace') return 'ps';
  if (a === 'hospital') return 'ks';
  if (a === 'fuel') return 'sp';
  if (a === 'nightclub' || a === 'bar') return 'hb';
  if (tg.railway) return 'rl';
  if (tg.man_made === 'works') return 'in';
  if (tg.aeroway) return 'bd';
  return null;
}
async function sekitar(la, lo) { return parseSekitar(await overpass(`[out:json][timeout:60];(nw(around:800,${la},${lo})[amenity~"^(school|kindergarten|college|university|place_of_worship|marketplace|hospital|fuel|nightclub|bar)$"];nw(around:800,${la},${lo})[railway~"^(rail|light_rail|tram|station|halt)$"];nw(around:800,${la},${lo})[man_made=works];nw(around:3000,${la},${lo})[aeroway~"^(aerodrome|runway|helipad)$"];node(around:6000,${la},${lo})[place~"^(city|town|village|hamlet|suburb)$"];);out tags geom 300;`), la, lo); }
export function parseSekitar(j, la, lo) {
  const kat = {}, tempat = [], JN = { city: 'k', town: 't', village: 'd', hamlet: 'h', suburb: 's' };
  (j.elements || []).forEach(e => {
    const tg = e.tags || {};
    if (tg.place && e.type === 'node') {
      if (!tg.name || !JN[tg.place]) return;
      const [x, y] = keMeter(la, lo, e.lat, e.lon), jg = jarakGaris([[x, y]]);
      tempat.push([String(tg.name).replace(/[\u0000-\u001f]/g, '').slice(0, 24), Math.round(jg.d), Math.round(jg.b), JN[tg.place]]);
      return;
    }
    const k = kodeKat(tg); if (!k) return;
    const pts = e.type === 'node' ? [keMeter(la, lo, e.lat, e.lon)] : (e.geometry || []).map(g => keMeter(la, lo, g.lat, g.lon));
    if (!pts.length) return;
    const jg = jarakGaris(pts), K = (kat[k] = kat[k] || { n: 0, d: Infinity, b: 0 });
    K.n++; if (jg.d < K.d) { K.d = jg.d; K.b = jg.b; }
  });
  const po = Object.entries(kat).map(([k, v]) => [k, v.n, Math.round(v.d), Math.round(v.b)]).sort((a, b) => a[2] - b[2]).slice(0, 10);
  tempat.sort((a, b) => a[1] - b[1]);
  const tp = tempat.slice(0, 6), kt = tempat.find(t => t[3] === 'k' || t[3] === 't');
  if (kt && !tp.includes(kt)) tp.push(kt);
  return { po, tp: tp.slice(0, 8) };
}

async function elevasi(la, lo) {
  const lats = [], lons = [];
  for (let r = 0; r < 7; r++) for (let c = 0; c < 7; c++) {   // baris 0 = utara, kolom 0 = barat; langkah 150 m
    lats.push((la + ((3 - r) * 150) / 110540).toFixed(5));
    lons.push((lo + ((c - 3) * 150) / (111320 * Math.cos(la * RAD))).toFixed(5));
  }
  const j = await ambil(`https://api.open-meteo.com/v1/elevation?latitude=${lats.join(',')}&longitude=${lons.join(',')}`);
  const el = (j.elevation || []).slice(0, 49).map(v => Math.round(+v || 0));
  if (el.length !== 49) throw new Error('grid elevasi tidak lengkap');
  return { el };
}

// Angin (setahun + dua semester), suhu, kelembapan & curah hujan bulanan dari satu panggilan arsip harian.
async function cuaca(la, lo) {
  const d2 = new Date(Date.now() - 3 * 864e5), d1 = new Date(d2 - 362 * 864e5), iso = d => d.toISOString().slice(0, 10);
  const j = await ambil(`https://archive-api.open-meteo.com/v1/archive?latitude=${la}&longitude=${lo}&start_date=${iso(d1)}&end_date=${iso(d2)}&daily=wind_speed_10m_max,wind_direction_10m_dominant,precipitation_sum,temperature_2m_max,temperature_2m_min,relative_humidity_2m_mean&wind_speed_unit=ms&timezone=auto`, {}, 50000);
  const D = j.daily || {}, T = D.time || [];
  if (!T.length) throw new Error('data cuaca kosong');
  const num = v => (v == null ? NaN : +v);
  const wr = Array(16).fill(0), wh = Array(16).fill(0), wk = Array(16).fill(0), sp = [];
  const mon = Array.from({ length: 12 }, () => ({ nh: 0, hj: 0, nx: 0, tx: 0, nn: 0, tn: 0, nr: 0, rh: 0 }));
  T.forEach((t, i) => {
    const mi = clamp((+String(t).slice(5, 7) || 1) - 1, 0, 11), M = mon[mi];
    const dir = num(D.wind_direction_10m_dominant?.[i]), v = num(D.wind_speed_10m_max?.[i]);
    if (Number.isFinite(dir) && Number.isFinite(v)) { const s = Math.round(dir / 22.5) % 16; wr[s] += v; (SEM1.includes(mi) ? wh : wk)[s] += v; sp.push(v); }
    const pr = num(D.precipitation_sum?.[i]), tx = num(D.temperature_2m_max?.[i]), tn = num(D.temperature_2m_min?.[i]), rh = num(D.relative_humidity_2m_mean?.[i]);
    if (Number.isFinite(pr)) { M.nh++; M.hj += pr; }
    if (Number.isFinite(tx)) { M.nx++; M.tx += tx; }
    if (Number.isFinite(tn)) { M.nn++; M.tn += tn; }
    if (Number.isFinite(rh)) { M.nr++; M.rh += rh; }
  });
  if (!sp.length) throw new Error('data angin kosong');
  const norm = a => { const tot = a.reduce((s, v) => s + v, 0) || 1; return a.map(v => Math.round((100 * v) / tot)); };
  sp.sort((a, b) => a - b);
  const r1 = v => Math.round(v * 10) / 10;
  return {
    wr: norm(wr), wh: norm(wh), wk: norm(wk), ws: Math.round(sp[Math.floor(sp.length / 2)] * 10),
    ik: { hj: mon.map((M, i) => (M.nh ? Math.round((M.hj * HARI_BLN[i]) / M.nh) : 0)), tx: mon.map(M => (M.nx ? r1(M.tx / M.nx) : 0)), tn: mon.map(M => (M.nn ? r1(M.tn / M.nn) : 0)), rh: mon.map(M => (M.nr ? Math.round(M.rh / M.nr) : 0)) },
  };
}

// prog(teks) melaporkan tahap; hasil = ringkasan kecil yang aman disimpan di model & link.
// punya = amb lama untuk titik yang SAMA → sumber yang sudah ada tidak diambil ulang (hemat kuota server).
// Overpass dijalankan berurutan (sopan pada server gratis), sementara Open-Meteo berjalan bersamaan.
export async function ambilData(la, lo, prog = () => {}, punya = null) {
  const amb = { ...(punya || {}) }, gagal = [];
  delete amb.gagal;
  const langkah = [
    ['jalan, sungai & tutupan lahan', !(amb.rd && amb.ek), osm, 'jalan/lahan'],
    ['bangunan sekitar', !amb.bg, bangunan, 'bangunan'],
    ['sekolah, pasar, ibadah, industri & permukiman terdekat', !(Array.isArray(amb.po) && Array.isArray(amb.tp)), sekitar, 'lingkungan'],
    ['elevasi 7×7 titik', !amb.el, elevasi, 'topografi'],
    ['angin, suhu, kelembapan & hujan 12 bulan', !(amb.wr && amb.ik), cuaca, 'iklim'],
  ];
  const total = langkah.filter(l => l[1]).length; let selesai = 0;
  const jalan = async ([teks, perlu, fn, nama]) => {
    try { Object.assign(amb, await fn(la, lo)); prog(`${++selesai}/${total} sumber selesai — ${teks} ✓`); }
    catch (e) { gagal.push(nama); prog(`${++selesai}/${total} sumber selesai — ${teks} gagal`); console.warn(nama, e); }
  };
  if (total) prog(`Mengambil ${total} sumber data…`);
  const perlu = langkah.filter(l => l[1]);
  await Promise.all([
    (async () => { for (const l of perlu.filter(x => x[3] === 'jalan/lahan' || x[3] === 'bangunan' || x[3] === 'lingkungan')) await jalan(l); })(),
    Promise.all(perlu.filter(x => x[3] === 'topografi' || x[3] === 'iklim').map(jalan)),
  ]);
  if (gagal.length) amb.gagal = gagal;
  return amb;
}

// ---------- matahari (dihitung sendiri, tanpa jaringan) ----------
function matahari(laDeg, hariKe, jam) {
  const φ = laDeg * RAD, δ = 23.45 * RAD * Math.sin(2 * Math.PI * (284 + hariKe) / 365), H = (jam - 12) * 15 * RAD;
  const alt = Math.asin(Math.sin(φ) * Math.sin(δ) + Math.cos(φ) * Math.cos(δ) * Math.cos(H));
  const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(φ) - Math.tan(δ) * Math.cos(φ));   // 0 = selatan, + ke barat
  return { alt: alt / RAD, az: ((az / RAD) + 180 + 360) % 360 };                                // → 0 = utara, searah jarum jam
}
const TGL = [[172, '21 Jun', '#d9a441'], [80, 'Ekuinoks', '#cc8f2f'], [355, '21 Des', '#bf7c28']];
function suryaHari(la, n) {
  const φ = la * RAD, δ = 23.45 * RAD * Math.sin(2 * Math.PI * (284 + n) / 365);
  const A = Math.acos(clamp(Math.sin(δ) / Math.cos(φ), -1, 1)) / RAD, h0 = Math.acos(clamp(-Math.tan(φ) * Math.tan(δ), -1, 1)) / RAD;
  return { terbit: A, tenggelam: 360 - A, maks: 90 - Math.abs(la - δ / RAD), panjang: (2 * h0) / 15 };
}
function arahTurun(el) {
  let gx = 0, gy = 0;   // gradien rata-rata: + = naik ke timur/utara
  for (let r = 0; r < 7; r++) for (let c = 0; c < 6; c++) gx += el[r * 7 + c + 1] - el[r * 7 + c];
  for (let r = 0; r < 6; r++) for (let c = 0; c < 7; c++) gy += el[r * 7 + c] - el[(r + 1) * 7 + c];   // baris 0 = utara
  const b = (Math.atan2(-gx, -gy) / RAD + 360) % 360;   // arah TURUN (kompas)
  return { b: Math.round(b), gx, gy };
}
const envDari = ek => ((ek.air || 0) >= 8 || (ek.sg && ek.sg.d < 350) ? 'air' : (ek.sawah || 0) + (ek.hutan || 0) >= Math.max(10, ek.bangun || 0) ? 'sawah' : 'kota');
const nmSungai = sg => (sg.n ? (/^(sungai|kali|krueng|batang|way)\b/i.test(sg.n) ? sg.n : 'Sungai ' + sg.n) : 'Sungai');

// ---------- perhitungan gabungan ----------
const L15 = { 1: 76, 2: 70, 3: 64, 4: 56 };   // ASUMSI: Leq siang dB(A) pada 15 m untuk jalan kelas 1 (arteri) … 4 (lingkungan)
const dbJalan = (c, d) => L15[c] - 4.5 * Math.log2(Math.max(d, 15) / 15);   // ≈ −4,5 dB tiap jarak berlipat dua (sumber garis + tanah lunak)

export function hitung(m, lk) {
  const amb = lk.amb || {}, hadap = m.sim?.hadap ?? 0, la = lk.la, H = { la, lo: lk.lo, hadap };
  // kebisingan jalan
  if (amb.rd?.length) {
    const rs = amb.rd.map(w => { const jg = jarakGaris(w.p); const d = w.d ?? jg.d, b = w.b ?? jg.b; return { ...w, d, b, db: dbJalan(w.c, d) }; }).sort((a, b) => a.d - b.d);
    const db = 10 * Math.log10(rs.reduce((s, w) => s + 10 ** (w.db / 10), 0)), utama = rs.filter(w => w.c <= 2)[0] || null;
    H.bising = { db: Math.round(db), tingkat: db < 45 ? 'Rendah' : db < 55 ? 'Sedang' : db < 65 ? 'Tinggi' : 'Sangat tinggi', dekat: rs[0], utama, sisi: sisiDari(rs[0].b, hadap), sisiUtama: utama ? sisiDari(utama.b, hadap) : null, roads: rs };
  }
  // matahari
  const rata = jams => { let sx = 0, sy = 0; TGL.forEach(([n]) => jams.forEach(j => { const s = matahari(la, n, j); if (s.alt > 8) { sx += Math.sin(s.az * RAD); sy += Math.cos(s.az * RAD); } })); const b = (Math.atan2(sx, sy) / RAD + 360) % 360; return { b, nm: arahNama(b), sisi: sisiDari(b, hadap) }; };
  H.matahari = { rows: TGL.map(([n, nm, col]) => ({ nm, col, ...suryaHari(la, n) })), sore: rata([14, 15, 16, 17]), pagi: rata([7, 8, 9, 10]) };
  // angin
  if (amb.wr) {
    const arg = a => a.indexOf(Math.max(...a)), dom = arg(amb.wr) * 22.5;
    H.angin = { dom, nm: arahNama(dom), sisi: sisiDari(dom, hadap), ws: (amb.ws || 0) / 10 };
    if (amb.wh && amb.wk) {
      const bas = amb.ik ? SEM1.reduce((s, i) => s + (amb.ik.hj[i] || 0), 0) >= (amb.ik.hj.reduce((s, v) => s + (+v || 0), 0) / 2) : null;
      H.angin.musim = [{ nm: 'Nov–Apr', wr: amb.wh, dom: arg(amb.wh) * 22.5, basah: bas }, { nm: 'Mei–Okt', wr: amb.wk, dom: arg(amb.wk) * 22.5, basah: bas == null ? null : !bas }];
    }
  }
  // topografi
  if (amb.el?.length === 49) {
    const el = amb.el, tapak = el[24], mn = Math.min(...el), mx = Math.max(...el);
    let gs = 0, n = 0;
    for (let r = 1; r <= 5; r++) for (let c = 1; c <= 5; c++) { gs += Math.hypot((el[r * 7 + c + 1] - el[r * 7 + c - 1]) / 300, (el[(r - 1) * 7 + c] - el[(r + 1) * 7 + c]) / 300); n++; }
    const persen = (100 * gs) / n;
    H.topo = { mn, mx, rng: mx - mn, tapak, persen, kelas: persen < 2 ? 'datar' : persen < 8 ? 'landai' : persen < 15 ? 'agak curam' : 'curam', turun: arahTurun(el).b, pos: Math.round((100 * el.filter(v => v <= tapak).length) / 49) };
  }
  // iklim
  if (amb.ik) {
    const { hj, tx, tn, rh } = amb.ik, sum = a => a.reduce((s, v) => s + (+v || 0), 0), avg = a => sum(a) / a.length;
    const bb = hj.filter(v => v > 100).length, bk = hj.filter(v => v < 60).length, Q = bb ? bk / bb : 99;   // Schmidt–Ferguson
    const tipe = Q < 0.143 ? ['A', 'sangat basah'] : Q < 0.333 ? ['B', 'basah'] : Q < 0.6 ? ['C', 'agak basah'] : Q < 1 ? ['D', 'sedang'] : Q < 1.67 ? ['E', 'agak kering'] : Q < 3 ? ['F', 'kering'] : Q < 7 ? ['G', 'sangat kering'] : ['H', 'luar biasa kering'];
    H.iklim = { thn: sum(hj), bb, bk, bl: 12 - bb - bk, Q, tipe, rhR: avg(rh), txR: avg(tx), tnR: avg(tn), txMax: Math.max(...tx), bulanPanas: BLN_N[tx.indexOf(Math.max(...tx))], bulanKering: BLN_N[hj.indexOf(Math.min(...hj))], bulanBasah: BLN_N[hj.indexOf(Math.max(...hj))], rhRendah: rh.map((v, i) => [v, i]).filter(([v]) => v > 0 && v < 70).map(([, i]) => BLN_N[i]) };
  }
  // ekologi & pakan (indeks HEURISTIK dari jenis lahan; bergantung kelengkapan peta OSM)
  if (amb.ek) {
    const ek = amb.ek, tot = Math.min(100, (ek.air || 0) + (ek.sawah || 0) + (ek.hutan || 0) + (ek.bangun || 0));
    const conf = tot >= 60 ? 1 : tot >= 30 ? 0.7 : 0.4;
    const mentah = 25 + 1.1 * (ek.sawah || 0) + 0.8 * (ek.hutan || 0) + 0.9 * Math.min(ek.air || 0, 25) + (ek.sg && ek.sg.d < 500 ? 8 : 0) - 0.35 * (ek.bangun || 0);
    H.eko = { ...ek, tot, tak: 100 - tot, conf, confNm: conf === 1 ? 'tinggi' : conf >= 0.7 ? 'sedang' : 'rendah', pakan: Math.round(clamp(50 + (clamp(mentah, 5, 100) - 50) * conf, 5, 100)), env: envDari(ek) };
  }
  // bangunan
  if (amb.bg) { const b = amb.bg; H.bangun = { ...b, kelas: b.p < 3 ? 'terbuka / perdesaan' : b.p < 12 ? 'perkampungan' : b.p < 25 ? 'permukiman padat' : 'padat perkotaan' }; }
  // air: risiko genangan
  if (H.topo || amb.ek?.sg || H.iklim) {
    let r = 0; const why = [];
    if (H.topo && H.topo.rng < 3) { r += 1; why.push(`lahan datar (beda tinggi ${H.topo.rng} m)`); }
    if (amb.ek?.sg && amb.ek.sg.d < 400) { r += 1; why.push(`${nmSungai(amb.ek.sg)} hanya ±${amb.ek.sg.d} m`); }
    if (H.topo && H.topo.pos < 25) { r += 1; why.push(`tapak lebih rendah dari ${100 - H.topo.pos}% area sekitar`); }
    if (H.iklim && H.iklim.thn > 3000) { r += 0.5; why.push(`hujan tinggi ±${fmt(Math.round(H.iklim.thn))} mm/th`); }
    H.air = { r, tingkat: r >= 2.5 ? 'Tinggi' : r >= 1.5 ? 'Sedang' : 'Rendah', why };
  }
  // skor kelayakan lokasi (INDIKATIF; bobot = asumsi)
  const F = [];
  F.push({ k: 'bising', nm: 'Kebisingan', w: 25, s: H.bising ? interp(H.bising.db, [[40, 95], [50, 80], [55, 65], [62, 45], [70, 20]]) : null });
  F.push({ k: 'pakan', nm: 'Sumber pakan', w: 25, s: H.eko ? H.eko.pakan : null });
  F.push({ k: 'iklim', nm: 'Suhu & kelembapan', w: 15, s: H.iklim ? 0.6 * clamp(100 - 3.2 * Math.abs(H.iklim.rhR - 80), 20, 100) + 0.4 * clamp(100 - 10 * Math.max(0, H.iklim.txR - 31) - 5 * Math.max(0, 22 - H.iklim.tnR), 20, 100) : null });
  F.push({ k: 'air', nm: 'Air & genangan', w: 15, s: H.air ? clamp(95 - 20 * H.air.r, 30, 95) : null });
  F.push({ k: 'angin', nm: 'Angin', w: 10, s: H.angin ? (H.angin.ws >= 8 ? 55 : H.angin.ws >= 6 ? 72 : H.angin.ws >= 1.5 ? 90 : 78) : null });
  F.push({ k: 'bangun', nm: 'Konteks bangunan', w: 10, s: H.bangun ? clamp((H.bangun.p < 3 ? 92 : H.bangun.p < 12 ? 85 : H.bangun.p < 25 ? 65 : 45) - (H.bangun.t3 && (H.bangun.dt ?? 999) < 150 ? 10 : 0), 20, 95) : null });
  const ada = F.filter(f => f.s != null), bobot = ada.reduce((s, f) => s + f.w, 0), total = bobot >= 60 ? Math.round(ada.reduce((s, f) => s + f.s * f.w, 0) / bobot) : null;
  H.skor = { faktor: F.map(f => ({ ...f, s: f.s == null ? null : Math.round(f.s) })), total, n: ada.length, label: total == null ? 'data belum cukup' : total >= 78 ? 'Sangat layak' : total >= 65 ? 'Layak dengan penyesuaian' : total >= 50 ? 'Perlu perhatian khusus' : 'Berisiko' };
  H.po = amb.po || []; H.tp = amb.tp || [];
  H.kp = kendalaPeluang(m, lk, H);
  return H;
}

function kendalaPeluang(m, lk, H) {
  const P = [], K = [];
  if (H.bising) { if (H.bising.db >= 55) K.push(`Bising jalan ±${H.bising.db} dB(A), terutama dari sisi ${H.bising.sisi} (${arahNama(H.bising.dekat.b).toLowerCase()}).`); else if (H.bising.db < 45) P.push(`Lingkungan tenang (±${H.bising.db} dB(A)) — suara tarik & inap mudah menonjol.`); }
  if (H.iklim) {
    const c = H.iklim;
    if (c.rhR >= 74 && c.rhR <= 86) P.push(`RH luar ±${Math.round(c.rhR)}% sudah dekat target ${RULES.rh[0]}–${RULES.rh[1]}% — kelembapan ruang mudah dijaga.`);
    else if (c.rhR < 72) K.push(`RH luar rendah (±${Math.round(c.rhR)}%) — perlu kolam & ventilasi tertata agar ruang tidak kering.`);
    else if (c.rhR > 88) K.push(`RH luar tinggi (±${Math.round(c.rhR)}%) — waspada jamur & pengap; ventilasi harus lancar.`);
    if (c.txR >= 32) K.push(`Siang panas (rata-rata suhu maks ±${d1(c.txR)} °C) — atap & dinding barat perlu peredam.`);
  }
  if (H.eko) { if (H.eko.pakan >= 68 && H.eko.conf >= 0.7) P.push(`Sumber pakan tampak baik (indeks ${H.eko.pakan}/100) — sawah/air/hutan di sekitar.`); else if (H.eko.pakan <= 40) K.push(`Sumber pakan tampak terbatas (indeks ${H.eko.pakan}/100, data OSM ${H.eko.confNm}) — cek langsung.`); }
  if (H.air && H.air.tingkat !== 'Rendah') K.push(`Risiko genangan ${H.air.tingkat.toLowerCase()}: ${H.air.why.join('; ')}.`);
  if (H.angin && H.angin.ws >= 6) K.push(`Angin cukup kencang (±${d1(H.angin.ws)} m/s dari ${H.angin.nm.toLowerCase()}) — ventilasi & LMB jangan menghadap arah itu.`);
  if (H.topo) { if (H.topo.persen >= 8) K.push(`Lahan ${H.topo.kelas} (±${d1(H.topo.persen)}%) — perlu perataan/drainase terarah.`); else if (H.topo.persen >= 2) P.push(`Lahan landai (±${d1(H.topo.persen)}%) — air mengalir alami ke ${arahNama(H.topo.turun).toLowerCase()}.`); }
  if (H.bangun) { if (H.bangun.t3 && (H.bangun.dt ?? 999) < 150) K.push(`Ada bangunan ≥3 lantai ±${H.bangun.dt} m — dapat menghalangi jalur terbang; menara/LMB perlu lebih tinggi.`); if (H.bangun.p < 5) P.push('Area terbuka — jalur terbang luas & minim halangan.'); else if (H.bangun.p >= 25) K.push(`Sekitar padat bangunan (±${H.bangun.p}% tutupan) — lebih bising & ruang terbang sempit.`); }
  (H.po || []).forEach(([k, n, d]) => {
    if (['in', 'rl', 'bd'].includes(k) && d < 600) K.push(`${KAT_NAMA[k]} ±${jrk(d)} — sumber bising/getaran.`);
    else if (k === 'ms' && d < 150) K.push(`Masjid/musala ±${jrk(d)} — pengeras suara menambah bising sesaat.`);
    else if (k === 'pd' && d < 150) K.push(`Sekolah ±${jrk(d)} — ramai pada jam masuk/pulang.`);
  });
  return { peluang: P, kendala: K };
}

// Saran nyata untuk desain di Walet Planner (memakai fitur & aturan yang ada di aplikasi).
export function implikasiLokasi(m, lk, H = hitung(m, lk)) {
  const a = [], hd = m.sim?.hadap ?? 0;
  if (H.matahari) a.push(`Sinar sore datang dari ${H.matahari.sore.nm.toLowerCase()} → sisi ${H.matahari.sore.sisi} gedung paling terpapar (depan gedung saat ini menghadap ${arahNama(hd).toLowerCase()}). Jangan hadapkan LMB ke arah itu; pakai "Cek lux" dan "Cek udara" untuk memastikan.`);
  if (H.bising && H.bising.db >= 55) a.push(`Bising jalan tinggi dari sisi ${H.bising.sisi}: jauhkan LMB & void dari sisi itu, pasang sekat/dinding bata di sisi tersebut, dan pertimbangkan volume suara tarik/inap di batas atas rentang buku (lihat "Cek dB").`);
  else if (H.bising) a.push(`Kebisingan ${H.bising.tingkat.toLowerCase()} (±${H.bising.db} dB(A)) — volume suara boleh mengikuti tabel buku untuk lingkungan ${H.eko ? SUARA[H.eko.env].label.toLowerCase() : 'setempat'}.`);
  if (H.angin) a.push(`Angin dominan dari ${H.angin.nm.toLowerCase()} mengenai sisi ${H.angin.sisi}${H.angin.ws >= 6 ? ' dengan kecepatan cukup tinggi — hindari LMB & ventilasi tepat menghadap arah itu' : ' — manfaatkan untuk ventilasi silang; ventilasi sebagai intake, LMB sebagai outtake'}. Tombol "Terapkan ke simulasi" mengisinya di "Cek udara".`);
  if (H.air && H.air.tingkat !== 'Rendah') a.push(`Risiko genangan ${H.air.tingkat.toLowerCase()}: tinggikan lantai dasar dan buat drainase ke arah ${H.topo ? arahNama(H.topo.turun).toLowerCase() : 'turunnya lahan'}; letakkan pintu masuk & ruang audio di sisi lahan yang lebih tinggi.`);
  if (H.iklim) {
    if (H.iklim.rhR < 72) a.push(`RH luar rendah (±${Math.round(H.iklim.rhR)}%): tambah kolam air di lantai dasar & rapatkan ventilasi; RH dalam target ${RULES.rh[0]}–${RULES.rh[1]}%.`);
    else if (H.iklim.rhR > 88) a.push(`RH luar tinggi (±${Math.round(H.iklim.rhR)}%): perbanyak/perlancar ventilasi & hindari kolam berlebih agar RH dalam tidak melewati ${RULES.rh[1]}%.`);
    if (H.iklim.txR >= 31) a.push(`Suhu siang ±${d1(H.iklim.txR)} °C (puncak ${H.iklim.bulanPanas}): batas atas suhu ruang ${RULES.suhu[1]} °C — cat luar putih, paranet berlapis & foil di bawah atap (lihat "Cek udara" per lantai).`);
  }
  if (H.eko) a.push(H.eko.pakan >= 65 ? `Sumber pakan baik — lingkungan condong "${SUARA[H.eko.env].label}"; terapkan profil suaranya.` : `Sumber pakan sedang/terbatas menurut peta (kepercayaan ${H.eko.confNm}) — cek sawah, rawa & kebun di lapangan dan populasi walet sekitar sebelum membangun; profil suara "${SUARA[H.eko.env].label}".`);
  if (H.bangun && H.bangun.t3 && (H.bangun.dt ?? 999) < 150) a.push(`Bangunan ≥3 lantai hanya ±${H.bangun.dt} m: naikkan menara/LMB di atas garis atap sekitar agar jalur terbang tidak terhalang.`);
  if (H.po.some(([k, , d]) => ['in', 'rl', 'bd'].includes(k) && d < 600)) a.push('Ada pabrik/rel/bandara dekat: cek getaran & bising di lapangan sebelum menetapkan lokasi.');
  a.push('Tekan "Terapkan ke simulasi" agar lintang matahari, angin, iklim luar (suhu & RH) dan lingkungan pengamatan terisi otomatis dari data lokasi ini.');
  return a;
}

export const BATASAN = [
  'Titik = koordinat yang Anda tempel; hasil hanya seakurat titik itu.',
  'Jalan, bangunan, sungai, sawah/hutan & fasilitas dari OpenStreetMap — belum semua wilayah terpetakan lengkap; lahan yang belum dipetakan tidak terhitung (ditampilkan sebagai "tak terpetakan").',
  'Angin, suhu, kelembapan & hujan: reanalisis ERA5 Open-Meteo (±10 km, 12 bulan terakhir) — gambaran iklim regional, bukan stasiun di titik. Elevasi: grid 7×7 (150 m) dari model medan ±90 m.',
  'dB(A) jalan & skor kelayakan = PERKIRAAN dengan asumsi sumber bising per kelas jalan dan bobot faktor — pedoman awal, bukan pengganti survei lapangan (populasi walet sekitar, kebisingan nyata, riwayat banjir).',
];

// ---------- teks bacaan ----------
export function teksLokasi(m, lk, H = hitung(m, lk)) {
  const t = { lokasi: [], bangunan: [], jalan: [], matahari: [], angin: [], air: [], topo: [], iklim: [], eko: [], aktif: [], kp: [], skor: [] }, amb = lk.amb || {};
  // lokasi
  const kt = H.tp.find(p => p[3] === 'k' || p[3] === 't'), dkt = H.tp[0];
  if (dkt) t.lokasi.push(`Permukiman terdekat ${dkt[0]} ±${jrk(dkt[1])} ke ${arahNama(dkt[2]).toLowerCase()}${kt && kt !== dkt ? `; kota/kecamatan terdekat ${kt[0]} ±${jrk(kt[1])}` : ''}.`);
  if (H.topo) t.lokasi.push(`Tapak di ±${H.topo.tapak} mdpl${H.iklim ? `, iklim tipe ${H.iklim.tipe[0]} (${H.iklim.tipe[1]}) menurut Schmidt–Ferguson` : ''}.`);
  // bangunan
  if (H.bangun) {
    const b = H.bangun;
    t.bangunan.push(`${b.n}${b.c ? '+' : ''} bangunan dalam 260 m (tutupan ±${b.p}%) — kawasan ${b.kelas}.`);
    if (b.dk != null) t.bangunan.push(`Bangunan terdekat ±${b.dk} m${b.lv ? `; tertinggi tercatat ${b.lv} lantai` : ''}${b.t3 ? `; ${b.t3} bangunan ≥3 lantai${b.dt != null ? ` (terdekat ±${b.dt} m)` : ''}` : ''}.`);
  }
  // jalan
  if (H.bising) {
    const B = H.bising;
    t.jalan.push(`Jalan terdekat ±${B.dekat.d} m (${B.dekat.n || 'tanpa nama'}) di sisi ${B.sisi}; perkiraan bising di tapak ±${B.db} dB(A) — ${B.tingkat.toLowerCase()}.`);
    if (B.utama) t.jalan.push(`Jalan utama terdekat: ${B.utama.n || 'tanpa nama'} ±${B.utama.d} m (sisi ${B.sisiUtama}).`);
    t.jalan.push(B.db >= 55 ? 'Cukup bising: jauhkan LMB & void dari sisi itu, pakai sekat/dinding bata di sisi jalan.' : B.db >= 45 ? 'Bising sedang: aman untuk RBW; hindari LMB tepat menghadap jalan.' : 'Lingkungan tenang — baik untuk walet.');
  }
  // matahari
  const S = H.matahari;
  t.matahari.push(`Matahari terbit di ${arahNama(S.rows[1].terbit).toLowerCase()} & terbenam di ${arahNama(S.rows[1].tenggelam).toLowerCase()} (ekuinoks); tinggi maks siang ${Math.round(S.rows[0].maks)}° (21 Jun) – ${Math.round(S.rows[2].maks)}° (21 Des).`);
  t.matahari.push(`Sinar sore dari ${S.sore.nm.toLowerCase()} → sisi ${S.sore.sisi} gedung paling panas; sinar pagi dari ${S.pagi.nm.toLowerCase()} → sisi ${S.pagi.sisi}.`);
  // angin
  if (H.angin) {
    t.angin.push(`Setahun dominan dari ${H.angin.nm.toLowerCase()} (mengenai sisi ${H.angin.sisi}), maks harian tipikal ${d1(H.angin.ws)} m/s.`);
    if (H.angin.musim) { const [a, b] = H.angin.musim; if (a.dom !== b.dom) t.angin.push(`Berubah menurut musim: ${a.nm} dari ${arahNama(a.dom).toLowerCase()}, ${b.nm} dari ${arahNama(b.dom).toLowerCase()}.`); }
    t.angin.push(H.angin.ws >= 6 ? 'Angin kencang: ventilasi & LMB jangan lurus menghadap arah ini.' : 'Angin normal — ventilasi silang aman.');
  }
  // air & hujan
  if (H.iklim) { const c = H.iklim; t.air.push(`Hujan ±${fmt(Math.round(c.thn))} mm/tahun: ${c.bb} bulan basah (>100 mm), ${c.bl} lembab, ${c.bk} kering (<60 mm); terbasah ${c.bulanBasah}, terkering ${c.bulanKering}.`); }
  if (H.air) t.air.push(`Risiko genangan ${H.air.tingkat.toLowerCase()}${H.air.why.length ? (H.air.tingkat === 'Rendah' ? ' — catatan: ' : ' — pemicu: ') + H.air.why.join('; ') : ' — tidak ada faktor pemicu terdeteksi dari data yang tersedia'}.`);
  // topo
  if (H.topo) { const o = H.topo; t.topo.push(`Elevasi ${o.mn}–${o.mx} mdpl (beda ${o.rng} m dalam ±450 m); kemiringan rata-rata ±${d1(o.persen)}% (${o.kelas}); air mengalir ke ${arahNama(o.turun).toLowerCase()}.`); t.topo.push(`Tapak lebih tinggi dari ±${o.pos}% area sekitar.`); }
  // iklim
  if (H.iklim) { const c = H.iklim; t.iklim.push(`Suhu maks rata-rata ±${d1(c.txR)} °C, min ±${d1(c.tnR)} °C (terpanas ${c.bulanPanas}); RH rata-rata ±${Math.round(c.rhR)}% (target ruang ${RULES.rh[0]}–${RULES.rh[1]}%).`); if (c.rhRendah.length) t.iklim.push(`RH luar di bawah 70% pada bulan ${c.rhRendah.join(', ')} — kolam/ventilasi perlu disesuaikan.`); }
  // eko
  if (H.eko) {
    const e = H.eko;
    t.eko.push(`Radius 1 km (yang terpetakan ${e.tot}%): air ${e.air || 0}%, sawah/kebun ${e.sawah || 0}%, hutan ${e.hutan || 0}%, permukiman ${e.bangun || 0}%${e.sg ? `; ${nmSungai(e.sg)} ±${e.sg.d} m` : ''}.`);
    t.eko.push(`Indeks pakan serangga ${e.pakan}/100 (asumsi dari jenis lahan; kepercayaan data ${e.confNm}) → profil suara "${SUARA[e.env].label}".`);
  }
  // aktif
  if (H.po.length) t.aktif.push(`Fasilitas terpetakan: ${H.po.slice(0, 4).map(([k, n, d]) => `${KAT_NAMA[k].toLowerCase()} ×${n} (terdekat ${jrk(d)})`).join('; ')}.`);
  else t.aktif.push('Tidak ada sekolah, pasar, ibadah, industri, rel, atau bandara terpetakan dalam 800 m — sesuai kelengkapan peta.');
  // skor
  if (H.skor.total != null) t.skor.push(`Skor ${H.skor.total}/100 — ${H.skor.label.toLowerCase()} (${H.skor.n} dari 6 faktor terhitung). Indikatif; bobot = asumsi.`);
  if (amb.gagal?.length) t.skor.push(`Data ${amb.gagal.join(', ')} belum terambil — klik "Analisis ulang".`);
  t.implikasi = implikasiLokasi(m, lk, H); t.saran = t.implikasi; t.batasan = BATASAN;
  return t;
}

// terapkan hasil ke pengaturan simulasi & pengamatan; kembalikan daftar perubahan (teks)
export function terapkanLokasi(m, lk) {
  const amb = lk.amb || {}, ubah = [], H = hitung(m, lk);
  m.sim = m.sim || {};
  if (lk.la >= -12 && lk.la <= 8) { m.sim.lintang = Math.round(lk.la * 10) / 10; ubah.push(`Lintang matahari: ${m.sim.lintang}°`); }
  if (H.angin) {
    m.sim.anginDari = H.angin.sisi; m.sim.anginKec = clamp(Math.round(H.angin.ws * 7) / 10, 0.5, 12);
    ubah.push(`Angin: dari sisi ${H.angin.sisi} (${H.angin.nm.toLowerCase()}), ${m.sim.anginKec} m/s`);
  }
  if (H.iklim) {
    const c = H.iklim;
    m.sim.tluar = clamp(Math.round(((c.txR + c.tnR) / 2) * 10) / 10, 15, 35); m.sim.tamp = clamp(Math.round(((c.txR - c.tnR) / 2) * 10) / 10, 0.5, 8); m.sim.rhl = clamp(Math.round(c.rhR), 30, 100);
    ubah.push(`Iklim luar: rata-rata ${d1(m.sim.tluar)} °C (±${d1(m.sim.tamp)}), RH ${m.sim.rhl}%`);
  }
  const sv = { ...(m.survey || {}) }; let s2 = false;
  if (H.eko) { sv.env = H.eko.env; s2 = true; ubah.push(`Lingkungan pengamatan: ${SUARA[H.eko.env].label} (profil suara & target dB ikut berubah)`); }
  if (H.iklim) { sv.rh = H.iklim.rhR >= 85 ? 'lembab' : H.iklim.rhR < 70 ? 'kering' : 'normal'; sv.suhu = H.iklim.txR > 31 ? 'panas' : 'ok'; s2 = true; }
  if (H.bangun) { sv.tinggi = H.bangun.t3 && (H.bangun.dt ?? 999) < 200 ? 'ya' : 'tidak'; s2 = true; }
  if (H.angin) { sv.angin = H.angin.sisi; s2 = true; }
  if (s2) m.survey = sv;
  if (H.iklim || H.bangun || H.angin) ubah.push('Pengamatan cepat: kelembapan, suhu siang, bangunan lebih tinggi & sisi angin diisi dari data');
  return ubah;
}

// ---------- panel-panel (SVG 380×272, gaya kertas hangat ala lembar arsitek) ----------
const PPW = 380, PPH = 272;
const C = { bg: '#fbf8f0', kartu: '#fdfbf5', bingkai: '#ddd6c4', ink: '#4a4636', sub: '#8a8171', sage: '#a9b78f', tapak: '#7c8f5f', air: '#8fb7cc', sawah: '#c9d69b', hutan: '#7f9f6b', bangun: '#b8ab97', mth: '#dd9c33', bad: '#b3563f', ok: '#5f8f4e', warn: '#c08a2e' };
const ROADC = { 1: '#565b4e', 2: '#767b6c', 3: '#989e8d', 4: '#c0c5b5' };
const T = (x, y, s, o = {}) => `<text x="${f1(x)}" y="${f1(y)}"${o.a ? ` text-anchor="${o.a}"` : ''} font-size="${o.s || 10.5}"${o.w ? ` font-weight="${o.w}"` : ''} fill="${o.c || C.ink}">${esc(s)}</text>`;
const potong = (s, n) => { const out = []; let cur = ''; String(s).split(' ').forEach(w => { if ((cur + ' ' + w).trim().length > n && cur) { out.push(cur); cur = w; } else cur = (cur ? cur + ' ' : '') + w; }); if (cur) out.push(cur); return out; };
const kartu = (judul, isi, sub2 = '') =>
  `<g><rect x="0.5" y="0.5" width="${PPW - 1}" height="${PPH - 1}" rx="8" fill="${C.kartu}" stroke="${C.bingkai}"/>` +
  `<text x="16" y="26" font-size="14.5" font-weight="700" fill="${C.ink}" letter-spacing=".4">${esc(judul)}</text>` +
  (sub2 ? `<text x="${PPW - 16}" y="26" text-anchor="end" font-size="10.5" fill="${C.sub}">${esc(sub2)}</text>` : '') +
  `<line x1="16" y1="34" x2="${PPW - 16}" y2="34" stroke="${C.bingkai}"/>${isi}</g>`;
const takAda = (judul, pesan = 'data belum ada — klik "Analisis ulang" untuk melengkapi') => kartu(judul, T(PPW / 2, PPH / 2 + 10, pesan, { s: 12, a: 'middle', c: C.sub }));
const baris = (g, x, y, k, v, o = {}) => g + T(x, y, k, { s: 9.3, c: C.sub }) + T(x, y + 13, v, { s: o.s || 11, w: 600, c: o.c });
const kompas = (cx, cy, R, o = {}) => [['U', 0, -1], ['T', 1, 0], ['S', 0, 1], ['B', -1, 0]].map(([t, dx, dy]) => T(cx + dx * (R + (o.g || 11)), cy + dy * (R + (o.g || 11)) + 4, t, { s: o.s || 11, w: 600, c: C.sub, a: 'middle' })).join('');
const tapakSym = (cx, cy, hadap, k = 1) => `<g transform="translate(${cx} ${cy}) rotate(${f1(hadap)}) scale(${k})"><rect x="-13" y="-8" width="26" height="16" fill="${C.tapak}" fill-opacity=".92" stroke="#fff"/><path d="M0 -8 L0 -21 M-4 -16 L0 -21 L4 -16" stroke="${C.tapak}" fill="none" stroke-width="1.7"/></g>`;

function pLokasi(m, lk, H) {
  const tp = lk.amb?.tp; if (!tp) return takAda('LOKASI & KONTEKS');
  const cx = 108, cy = 160, R = 92, RM = 6000;
  let g = `<circle cx="${cx}" cy="${cy}" r="${R}" fill="#f6f2e4" stroke="${C.bingkai}"/>`;
  const RK = d => Math.sqrt(Math.min(d, RM) / RM) * R;   // skala akar: permukiman dekat tetap terpisah
  [[500, '500 m'], [2000, '2 km']].forEach(([d]) => { g += `<circle cx="${cx}" cy="${cy}" r="${f1(RK(d))}" fill="none" stroke="${C.bingkai}" stroke-dasharray="3 4"/>`; });
  [[500, '500 m'], [2000, '2 km'], [6000, '6 km']].forEach(([d, t]) => { g += T(cx + 3, cy - RK(d) + 9, t, { s: 7.6, c: C.sub }); });
  g += kompas(cx, cy, R, { g: 9, s: 10 });
  const kotak = [];
  tp.forEach(([nm, d, b, j], i) => {
    const r = RK(d), a = b * RAD, x = cx + r * Math.sin(a), y = cy - r * Math.cos(a), sz = { k: 5.6, t: 4.8, d: 3.6, h: 2.8, s: 3 }[j] || 3;
    g += `<circle cx="${f1(x)}" cy="${f1(y)}" r="${sz}" fill="${j === 'k' || j === 't' ? C.bad : C.hutan}" stroke="#fff" stroke-width=".8"/>`;
    if (i < 7) {
      const w = nm.length * 4.5;
      for (const kanan of [x >= cx, x < cx]) {
        const lx = kanan ? x + sz + 2 : x - sz - 2, x0 = kanan ? lx : lx - w, x1 = kanan ? lx + w : lx;
        if (x0 < 6 || x1 > 210 || kotak.some(q => q.x0 < x1 && x0 < q.x1 && Math.abs(q.y - y) < 9)) continue;
        kotak.push({ x0, x1, y }); g += T(lx, y + 3, nm, { s: 8.4, a: kanan ? 'start' : 'end' }); break;
      }
    }
  });
  g += `<rect x="${cx - 4}" y="${cy - 4}" width="8" height="8" fill="${C.tapak}" stroke="#fff" stroke-width="1.2"/>`;
  let y = 58; const X = 222;
  g = baris(g, X, y, 'Koordinat', `${lk.la}, ${lk.lo}`, { s: 10.3 }); y += 34;
  g = baris(g, X, y, 'Elevasi tapak', H.topo ? `±${H.topo.tapak} mdpl` : '—'); y += 34;
  const dk = tp[0], kt = tp.find(p => p[3] === 'k' || p[3] === 't');
  g = baris(g, X, y, 'Permukiman terdekat', dk ? `${dk[0]} · ${jrk(dk[1])}` : '—', { s: 10.3 }); y += 34;
  g = baris(g, X, y, 'Kota / kecamatan terdekat', kt ? `${kt[0]} · ${jrk(kt[1])}` : '—', { s: 10.3 }); y += 34;
  g = baris(g, X, y, 'Tipe iklim (Schmidt–Ferguson)', H.iklim ? `${H.iklim.tipe[0]} — ${H.iklim.tipe[1]}` : '—', { s: 10.3 });
  g += `<circle cx="${X + 4}" cy="246" r="3.6" fill="${C.bad}"/>` + T(X + 11, 249, 'kota / kecamatan', { s: 8.3, c: C.sub }) + `<circle cx="${X + 4}" cy="258" r="2.8" fill="${C.hutan}"/>` + T(X + 11, 261, 'desa / kampung · skala akar', { s: 8.3, c: C.sub });
  return kartu('LOKASI & KONTEKS', g, 'radius 6 km');
}

function pBangun(m, lk, H) {
  const b = lk.amb?.bg; if (!b?.g) return takAda('KONTEKS BANGUNAN');
  const x0 = 16, y0 = 46, cell = 7.4, N = 25;
  let g = `<defs><clipPath id="lkb"><rect x="${x0}" y="${y0}" width="${N * cell}" height="${N * cell}"/></clipPath></defs><rect x="${x0}" y="${y0}" width="${f1(N * cell)}" height="${f1(N * cell)}" fill="#f3efe2" stroke="${C.bingkai}"/><g clip-path="url(#lkb)">`;
  b.g.forEach((s, r) => { const bits = parseInt(s, 36) || 0; for (let c = 0; c < N; c++) if (bits & (1 << c)) g += `<rect x="${f1(x0 + c * cell)}" y="${f1(y0 + r * cell)}" width="${f1(cell - 0.5)}" height="${f1(cell - 0.5)}" fill="${C.bangun}"/>`; });
  const mx = x0 + 12.5 * cell, my = y0 + 12.5 * cell;
  g += `</g><circle cx="${f1(mx)}" cy="${f1(my)}" r="${f1(5 * cell)}" fill="none" stroke="${C.tapak}" stroke-width=".9" stroke-dasharray="3 3"/><circle cx="${f1(mx)}" cy="${f1(my)}" r="${f1(12.5 * cell)}" fill="none" stroke="${C.bingkai}" stroke-dasharray="3 4"/>`;
  g += `<rect x="${f1(mx - 4.5)}" y="${f1(my - 4.5)}" width="9" height="9" fill="${C.tapak}" stroke="#fff" stroke-width="1.2"/>` + T(x0, y0 + N * cell + 12, 'lingkaran putus = 100 m & 250 m · 1 kotak = 20 m', { s: 8.3, c: C.sub });
  let y = 60; const X = 218;
  g = baris(g, X, y, 'Bangunan terpetakan', `${b.n}${b.c ? '+' : ''} dalam 260 m`); y += 33;
  g = baris(g, X, y, 'Tutupan bangunan', `±${b.p}% · ${H.bangun.kelas}`, { s: 10.3 }); y += 33;
  g = baris(g, X, y, 'Bangunan terdekat', b.dk != null ? `±${b.dk} m` : '—'); y += 33;
  g = baris(g, X, y, 'Tertinggi tercatat', b.lv ? `${b.lv} lantai` : 'tidak tercatat di peta'); y += 33;
  g = baris(g, X, y, 'Bangunan ≥ 3 lantai', b.t3 ? `${b.t3} bh${b.dt != null ? ` · terdekat ±${b.dt} m` : ''}` : 'tidak ada tercatat', { c: b.t3 && (b.dt ?? 999) < 150 ? C.bad : undefined });
  return kartu('KONTEKS BANGUNAN', g, 'radius 260 m');
}

function pJalan(m, lk, H) {
  const B = H.bising; if (!B) return takAda('AKSES & JALAN (KEBISINGAN)');
  const cx = 112, cy = 152, rp = 90, sk = rp / 500;
  let g = `<defs><clipPath id="lkj"><circle cx="${cx}" cy="${cy}" r="${rp}"/></clipPath></defs>`;
  g += `<circle cx="${cx}" cy="${cy}" r="${rp}" fill="#f3efe2" stroke="${C.bingkai}"/><circle cx="${cx}" cy="${cy}" r="${rp / 2}" fill="none" stroke="${C.bingkai}" stroke-dasharray="3 4"/>`;
  g += `<g clip-path="url(#lkj)">` + lk.amb.rd.slice().reverse().map(w => `<polyline points="${w.p.map(p => `${f1(cx + p[0] * sk)},${f1(cy - p[1] * sk)}`).join(' ')}" fill="none" stroke="${ROADC[w.c]}" stroke-width="${w.c === 1 ? 5 : w.c === 2 ? 3.6 : w.c === 3 ? 2.5 : 1.7}" stroke-linecap="round" stroke-linejoin="round"/>`).join('') + '</g>';
  g += tapakSym(cx, cy, H.hadap, 0.5) + kompas(cx, cy, rp, { g: 9, s: 10 }) + T(16, 266, 'radius 500 m · panah = depan gedung', { s: 8.3, c: C.sub });
  const wc = B.tingkat === 'Rendah' ? C.ok : B.tingkat === 'Sedang' ? C.warn : C.bad;
  const X = 228; let y = 56;
  g += T(X, y, 'Perkiraan bising di tapak', { s: 9.3, c: C.sub }) + T(X, y + 18, `±${B.db} dB(A)`, { s: 16, w: 700, c: wc }) + T(X, y + 32, B.tingkat, { s: 10.5, w: 600, c: wc });
  y += 52; g += T(X, y, 'Jalan terdekat', { s: 9.3, c: C.sub }); y += 12;
  B.roads.slice(0, 4).forEach(w => {
    g += `<line x1="${X}" y1="${y - 3}" x2="${X + 14}" y2="${y - 3}" stroke="${ROADC[w.c]}" stroke-width="${w.c === 1 ? 4.5 : w.c === 2 ? 3.2 : 2.2}"/>` + T(X + 19, y, `${(w.n || ['jln arteri', 'jln besar', 'jln sedang', 'jln kecil'][w.c - 1]).replace(/^Jalan /, 'Jl. ').slice(0, 14)} · ${w.d} m`, { s: 9.3 }) + T(X + 19, y + 10.5, `sisi ${sisiDari(w.b, H.hadap)} (${arahNama(w.b).toLowerCase()})`, { s: 8.3, c: C.sub });
    y += 25;
  });
  return kartu('AKSES & JALAN (KEBISINGAN)', g, `terdekat ±${B.dekat.d} m`);
}

function pMatahari(m, lk, H) {
  const cx = 104, cy = 160, R = 88, la = lk.la;
  let g = `<circle cx="${cx}" cy="${cy}" r="${R}" fill="#f6f2e4" stroke="${C.bingkai}"/>` + kompas(cx, cy, R, { g: 10, s: 10.5 });
  TGL.forEach(([n, nm, col]) => {
    const pts = [];
    for (let j = 5.5; j <= 18.5; j += 0.25) { const s = matahari(la, n, j); if (s.alt <= 0) continue; const r = ((90 - s.alt) / 90) * R, a = (s.az - 90) * RAD; pts.push(`${f1(cx + r * Math.cos(a))},${f1(cy + r * Math.sin(a))}`); }
    if (pts.length > 1) g += `<polyline points="${pts.join(' ')}" fill="none" stroke="${col}" stroke-width="1.6" stroke-dasharray="${nm === 'Ekuinoks' ? '' : '5 3'}"/>`;
  });
  for (const j of [6, 9, 12, 15, 18]) { const s = matahari(la, 80, j); if (s.alt <= 0) continue; const r = ((90 - s.alt) / 90) * R, a = (s.az - 90) * RAD, x = cx + r * Math.cos(a), y = cy + r * Math.sin(a); g += `<circle cx="${f1(x)}" cy="${f1(y)}" r="4.6" fill="${C.mth}" stroke="#fff"/>` + T(x, y - 7, j, { s: 8, a: 'middle', c: C.sub }); }
  g += tapakSym(cx, cy, H.hadap, 0.85);
  const X = 214; let y = 50;
  H.matahari.rows.forEach(r => {
    g += T(X, y, r.nm, { s: 10.3, w: 700, c: r.col }) + T(X, y + 11, `terbit ${arahNama(r.terbit).toLowerCase()} · terbenam ${arahNama(r.tenggelam).toLowerCase()}`, { s: 8.6 }) + T(X, y + 21.5, `tinggi maks ${Math.round(r.maks)}° · lama siang ${d1(r.panjang)} j`, { s: 8.6, c: C.sub });
    y += 37;
  });
  y += 4;
  g += T(X, y, 'Sisi paling terpapar', { s: 9.3, c: C.sub });
  g += T(X, y + 14, `Sore (14–17): sisi ${H.matahari.sore.sisi}`, { s: 10.3, w: 700, c: C.bad }) + T(X, y + 25, `sinar dari ${H.matahari.sore.nm.toLowerCase()}`, { s: 8.6, c: C.sub });
  g += T(X, y + 40, `Pagi (7–10): sisi ${H.matahari.pagi.sisi}`, { s: 10.3, w: 700, c: C.warn }) + T(X, y + 51, `sinar dari ${H.matahari.pagi.nm.toLowerCase()}`, { s: 8.6, c: C.sub });
  return kartu('JALUR MATAHARI', g, `lintang ${f1(la)}°`);
}

function pAngin(m, lk, H) {
  const A = H.angin; if (!A) return takAda('ANGIN (12 BULAN)');
  const rose = (cx, cy, R, wr, dom) => {
    const mx = Math.max(...wr, 1), di = dom / 22.5;
    let g = `<circle cx="${cx}" cy="${cy}" r="${R}" fill="#f6f2e4" stroke="${C.bingkai}"/><circle cx="${cx}" cy="${cy}" r="${R / 2}" fill="none" stroke="${C.bingkai}" stroke-dasharray="3 4"/>`;
    wr.forEach((v, i) => {
      const a = i * 22.5 * RAD, w2 = 9 * RAD, r = (v / mx) * (R - 6), p = k => `${f1(cx + r * Math.sin(a + k))},${f1(cy - r * Math.cos(a + k))}`;
      g += `<polygon points="${cx},${cy} ${p(-w2)} ${f1(cx + r * 1.06 * Math.sin(a))},${f1(cy - r * 1.06 * Math.cos(a))} ${p(w2)}" fill="${i === di ? '#6f8f5a' : C.sage}" fill-opacity="${i === di ? 0.95 : 0.55}" stroke="#fff" stroke-width="0.6"/>`;
    });
    return g + kompas(cx, cy, R, { g: 8, s: 9.5 });
  };
  const wm = A.musim; let g = '';
  if (wm) {
    [[96, wm[0]], [284, wm[1]]].forEach(([cx, s]) => {
      g += rose(cx, 138, 60, s.wr, s.dom) + T(cx, 224, `${s.nm}${s.basah == null ? '' : s.basah ? ' · lebih basah' : ' · lebih kering'}`, { s: 10, w: 700, a: 'middle' }) + T(cx, 237, `dominan dari ${arahNama(s.dom).toLowerCase()}`, { s: 9.3, a: 'middle', c: C.sub });
    });
    g += T(190, 256, `Setahun: dari ${A.nm.toLowerCase()} → sisi ${A.sisi} gedung · maks harian tipikal ${d1(A.ws)} m/s`, { s: 9.6, a: 'middle', w: 600 });
  } else {
    g += rose(110, 155, 84, lk.amb.wr, A.dom) + T(232, 90, 'Dominan dari', { s: 9.5, c: C.sub }) + T(232, 108, A.nm, { s: 14, w: 700 }) + T(232, 132, 'Maks harian tipikal', { s: 9.5, c: C.sub }) + T(232, 150, `${d1(A.ws)} m/s`, { s: 14, w: 700 }) + T(232, 176, `mengenai sisi ${A.sisi}`, { s: 10 });
  }
  return kartu('ANGIN (12 BULAN)', g, 'mawar angin harian');
}

function pAir(m, lk, H) {
  const c = H.iklim; if (!c) return takAda('AIR & CURAH HUJAN');
  const hj = lk.amb.ik.hj, X0 = 24, W = 332, bw = 19, mx = Math.max(...hj, 120), sc = 96 / mx, yb = 150;
  let g = '';
  [[100, 'basah >100'], [60, 'kering <60']].forEach(([v, t]) => { if (v <= mx) g += `<line x1="${X0}" y1="${f1(yb - v * sc)}" x2="${X0 + W}" y2="${f1(yb - v * sc)}" stroke="${C.bingkai}" stroke-dasharray="3 3"/>` + T(X0 - 3, yb - v * sc + 3, v, { s: 7.5, a: 'end', c: C.sub }); });
  hj.forEach((v, i) => {
    const x = X0 + i * (W / 12) + (W / 12 - bw) / 2, h = Math.max(1.5, v * sc);
    g += `<rect x="${f1(x)}" y="${f1(yb - h)}" width="${bw}" height="${f1(h)}" rx="2" fill="${v > 100 ? '#5d8fb0' : v >= 60 ? '#9cc0d4' : '#dcc9a0'}"/>` + T(x + bw / 2, yb + 11, BLN[i], { s: 8.5, a: 'middle', c: C.sub }) + (v === Math.max(...hj) || v === Math.min(...hj) ? T(x + bw / 2, yb - h - 3, v, { s: 7.6, a: 'middle', c: C.ink }) : '');
  });
  g += T(16, 176, `Total ±${fmt(Math.round(c.thn))} mm/tahun`, { s: 12, w: 700 }) + T(16, 191, `${c.bb} bulan basah · ${c.bl} lembab · ${c.bk} kering — tipe ${c.tipe[0]} (${c.tipe[1]})`, { s: 9.3, c: C.sub });
  const A = H.air, wc = A ? (A.tingkat === 'Rendah' ? C.ok : A.tingkat === 'Sedang' ? C.warn : C.bad) : C.sub;
  if (A) {
    g += `<rect x="16" y="200" width="${PPW - 32}" height="58" rx="6" fill="${C.bg}" stroke="${C.bingkai}"/>` + T(26, 216, `Risiko genangan: ${A.tingkat}`, { s: 11.5, w: 700, c: wc });
    potong(A.why.length ? (A.tingkat === 'Rendah' ? 'Catatan: ' : 'Pemicu: ') + A.why.join('; ') : 'tidak ada faktor pemicu terdeteksi dari data yang tersedia', 66).slice(0, 3).forEach((l, i) => { g += T(26, 230 + i * 11.5, l, { s: 9.4 }); });
  }
  return kartu('AIR & CURAH HUJAN', g, 'Schmidt–Ferguson');
}

function pTopo(m, lk, H) {
  const el = lk.amb?.el, o = H.topo; if (!el?.length || !o) return takAda('TOPOGRAFI');
  const x0 = 16, y0 = 46, cell = 26.5, mn = o.mn, rng = Math.max(1, o.rng);
  const warna = v => { const t = (v - mn) / rng; const mix = (a, b) => Math.round(a + (b - a) * t); return `rgb(${mix(169, 138)},${mix(192, 111)},${mix(138, 77)})`; };
  let g = '';
  for (let r = 0; r < 7; r++) for (let c = 0; c < 7; c++) {
    const v = el[r * 7 + c];
    g += `<rect x="${f1(x0 + c * cell)}" y="${f1(y0 + r * cell)}" width="${cell}" height="${cell}" fill="${warna(v)}" fill-opacity=".82"/>`;
    const kanan = c < 6 && Math.round((el[r * 7 + c + 1] - mn) / rng * 4) !== Math.round((v - mn) / rng * 4);
    const bawah = r < 6 && Math.round((el[(r + 1) * 7 + c] - mn) / rng * 4) !== Math.round((v - mn) / rng * 4);
    if (kanan) g += `<line x1="${f1(x0 + (c + 1) * cell)}" y1="${f1(y0 + r * cell)}" x2="${f1(x0 + (c + 1) * cell)}" y2="${f1(y0 + (r + 1) * cell)}" stroke="#6d6350" stroke-width="0.9"/>`;
    if (bawah) g += `<line x1="${f1(x0 + c * cell)}" y1="${f1(y0 + (r + 1) * cell)}" x2="${f1(x0 + (c + 1) * cell)}" y2="${f1(y0 + (r + 1) * cell)}" stroke="#6d6350" stroke-width="0.9"/>`;
  }
  g += `<rect x="${x0}" y="${y0}" width="${f1(7 * cell)}" height="${f1(7 * cell)}" fill="none" stroke="${C.bingkai}"/><rect x="${f1(x0 + 3 * cell + 6)}" y="${f1(y0 + 3 * cell + 6)}" width="${f1(cell - 12)}" height="${f1(cell - 12)}" fill="${C.tapak}" stroke="#fff"/>`;
  g += T(x0, y0 + 7 * cell + 11, `1 kotak = 150 m · garis = selang ${Math.max(1, Math.round(rng / 4))} m`, { s: 8.3, c: C.sub });
  const ax = 268, ay = 76, ar = 20, aa = o.turun * RAD;
  g += `<circle cx="${ax}" cy="${ay}" r="${ar + 6}" fill="#f6f2e4" stroke="${C.bingkai}"/><path d="M${f1(ax - ar * Math.sin(aa))} ${f1(ay + ar * Math.cos(aa))} L${f1(ax + ar * Math.sin(aa))} ${f1(ay - ar * Math.cos(aa))}" stroke="#8a6f4d" stroke-width="2"/><path d="M${f1(ax + ar * Math.sin(aa))} ${f1(ay - ar * Math.cos(aa))} l${f1(-7 * Math.sin(aa + 0.5))} ${f1(7 * Math.cos(aa + 0.5))} m${f1(7 * Math.sin(aa + 0.5))} ${f1(-7 * Math.cos(aa + 0.5))} l${f1(-7 * Math.sin(aa - 0.5))} ${f1(7 * Math.cos(aa - 0.5))}" stroke="#8a6f4d" stroke-width="2" fill="none"/>`;
  g += T(ax + 38, ay - 4, 'air mengalir ke', { s: 8.8, c: C.sub }) + T(ax + 38, ay + 9, arahNama(o.turun), { s: 10.5, w: 700 });
  let y = 122; const X = 218;
  g = baris(g, X, y, 'Elevasi sekitar', `${o.mn}–${o.mx} mdpl (beda ${o.rng} m)`, { s: 10.3 }); y += 33;
  g = baris(g, X, y, 'Kemiringan rata-rata', `±${d1(o.persen)}% · ${o.kelas}`, { s: 10.3 }); y += 33;
  g = baris(g, X, y, 'Posisi tapak', `lebih tinggi dari ${o.pos}% area`, { s: 10.3 });
  return kartu('TOPOGRAFI', g, `±450 m · beda ${o.rng} m`);
}

function pIklim(m, lk, H) {
  const ik = lk.amb?.ik, c = H.iklim; if (!ik || !c) return takAda('SUHU & KELEMBAPAN');
  const X0 = 42, W = 320, xs = i => X0 + (i + 0.5) * (W / 12), ys = v => 124 - ((clamp(v, 20, 36) - 20) / 16) * 76, yr = v => 198 - ((clamp(v, 50, 100) - 50) / 50) * 52;
  let g = T(16, 50, '°C', { s: 8.5, c: C.sub }) + T(16, 146, 'RH %', { s: 8.5, c: C.sub });
  [[26, '26'], [31, '31']].forEach(([v, t]) => { g += `<line x1="${X0}" y1="${f1(ys(v))}" x2="${X0 + W}" y2="${f1(ys(v))}" stroke="#c9a66b" stroke-dasharray="3 3"/>` + T(X0 - 4, ys(v) + 3, t, { s: 8, a: 'end', c: C.sub }); });
  g += `<polygon points="${ik.tx.map((v, i) => `${f1(xs(i))},${f1(ys(v))}`).join(' ')} ${ik.tn.map((v, i) => `${f1(xs(i))},${f1(ys(v))}`).reverse().join(' ')}" fill="#e9c98a" fill-opacity=".55"/>`;
  g += `<polyline points="${ik.tx.map((v, i) => `${f1(xs(i))},${f1(ys(v))}`).join(' ')}" fill="none" stroke="#c0782a" stroke-width="1.6"/><polyline points="${ik.tn.map((v, i) => `${f1(xs(i))},${f1(ys(v))}`).join(' ')}" fill="none" stroke="#6f93bf" stroke-width="1.6"/>`;
  g += T(X0 + W, 48, 'garis putus = target suhu ruang 26–31 °C', { s: 8, a: 'end', c: C.sub });
  g += `<rect x="${X0}" y="${f1(yr(85))}" width="${W}" height="${f1(yr(75) - yr(85))}" fill="${C.sage}" fill-opacity=".38"/>` + T(X0 - 4, yr(80) + 3, '80', { s: 8, a: 'end', c: C.sub }) + T(X0 + W, 143, 'pita hijau = target RH ruang 75–85%', { s: 8, a: 'end', c: C.sub });
  g += `<polyline points="${ik.rh.map((v, i) => `${f1(xs(i))},${f1(yr(v))}`).join(' ')}" fill="none" stroke="#4f86a8" stroke-width="1.8"/>` + ik.rh.map((v, i) => `<circle cx="${f1(xs(i))}" cy="${f1(yr(v))}" r="2.2" fill="#4f86a8"/>`).join('');
  BLN.forEach((b, i) => { g += T(xs(i), 210, b, { s: 8.5, a: 'middle', c: C.sub }); });
  g += T(16, 228, `Suhu maks ±${d1(c.txR)} °C · min ±${d1(c.tnR)} °C · RH ±${Math.round(c.rhR)}%`, { s: 10.3, w: 700 });
  g += T(16, 241, `Terpanas: ${c.bulanPanas} (±${d1(c.txMax)} °C) · ${c.txR >= 31 ? 'di atas' : 'di bawah'} batas atas ruang ${RULES.suhu[1]} °C`, { s: 9.3, c: C.sub });
  g += T(16, 254, c.rhRendah.length ? `RH luar <70% pada: ${c.rhRendah.join(', ')}` : `RH luar ${c.rhR >= 75 && c.rhR <= 85 ? 'sudah di rentang target' : c.rhR < 75 ? 'di bawah target — perlu kolam' : 'di atas target — perlu ventilasi'}`, { s: 9.3, c: C.sub });
  return kartu('SUHU & KELEMBAPAN', g, '12 bulan terakhir');
}

function pEko(m, lk, H) {
  const e = H.eko; if (!e) return takAda('EKOLOGI (RADIUS 1 KM)');
  const item = [['air', 'Air / rawa', C.air], ['sawah', 'Sawah / kebun', C.sawah], ['hutan', 'Hutan / semak', C.hutan], ['bangun', 'Permukiman', C.bangun], ['tak', 'Tak terpetakan', '#e6e1d2']];
  const val = { air: e.air || 0, sawah: e.sawah || 0, hutan: e.hutan || 0, bangun: e.bangun || 0, tak: e.tak };
  const cx = 80, cy = 128, R = 54, r2 = 32;
  let a0 = -Math.PI / 2, g = '';
  item.forEach(([k, , col]) => {
    const v = val[k]; if (!v) return;
    const a1 = a0 + 2 * Math.PI * (Math.min(v, 100) / 100), big = a1 - a0 > Math.PI ? 1 : 0;
    g += `<path d="M${f1(cx + R * Math.cos(a0))} ${f1(cy + R * Math.sin(a0))} A${R} ${R} 0 ${big} 1 ${f1(cx + R * Math.cos(a1))} ${f1(cy + R * Math.sin(a1))} L${f1(cx + r2 * Math.cos(a1))} ${f1(cy + r2 * Math.sin(a1))} A${r2} ${r2} 0 ${big} 0 ${f1(cx + r2 * Math.cos(a0))} ${f1(cy + r2 * Math.sin(a0))} Z" fill="${col}" stroke="#fff" stroke-width="1"/>`;
    a0 = a1;
  });
  g += `<circle cx="${cx}" cy="${cy}" r="4.5" fill="${C.tapak}" stroke="#fff"/>`;
  let y = 60;
  item.forEach(([k, nm, col]) => { g += `<rect x="158" y="${y - 10}" width="12" height="12" rx="2" fill="${col}" stroke="${C.bingkai}" stroke-width=".6"/>` + T(176, y, nm, { s: 10.3 }) + T(PPW - 18, y, `${val[k]}%`, { s: 10.3, w: 700, a: 'end' }); y += 19; });
  if (e.sg) g += T(158, y + 4, `${nmSungai(e.sg)} ±${e.sg.d} m ke ${arahNama(e.sg.b).toLowerCase()}`, { s: 9.3, c: C.sub });
  g += T(16, 208, 'Indeks pakan serangga (asumsi dari jenis lahan)', { s: 9.5, c: C.sub });
  g += `<rect x="16" y="215" width="${PPW - 32}" height="12" rx="6" fill="#ece6d4"/><rect x="16" y="215" width="${f1((PPW - 32) * e.pakan / 100)}" height="12" rx="6" fill="${e.pakan >= 65 ? C.ok : e.pakan >= 40 ? C.warn : C.bad}"/>` + T(PPW - 20, 225, `${e.pakan} / 100`, { s: 9.5, w: 700, a: 'end', c: C.ink });
  g += T(16, 245, `Kepercayaan data: ${e.confNm} — peta OSM baru memetakan ${e.tot}% area radius 1 km.`, { s: 9.2, c: C.sub }) + T(16, 258, `Lingkungan condong "${SUARA[e.env].label}".`, { s: 9.2, c: C.sub });
  return kartu('EKOLOGI (RADIUS 1 KM)', g);
}

function pAktif(m, lk, H) {
  if (!Array.isArray(lk.amb?.po)) return takAda('SUMBER BISING & AKTIVITAS');
  let g = '', y = 56;
  if (!H.po.length) g += T(PPW / 2, 140, 'Tidak ada sekolah, pasar, tempat ibadah, industri,', { s: 11, a: 'middle', c: C.sub }) + T(PPW / 2, 156, 'rel, atau bandara terpetakan dalam 800 m.', { s: 11, a: 'middle', c: C.sub }) + T(PPW / 2, 178, 'Lingkungan relatif sunyi (sesuai kelengkapan peta).', { s: 10, a: 'middle', c: C.ok });
  H.po.slice(0, 8).forEach(([k, n, d, b]) => {
    const a = b * RAD, ax = 26, ay = y - 4;
    g += `<circle cx="${ax}" cy="${ay}" r="9" fill="#f3efe2" stroke="${C.bingkai}"/><path d="M${f1(ax + 6.5 * Math.sin(a))} ${f1(ay - 6.5 * Math.cos(a))} L${f1(ax + 3.2 * Math.sin(a + 2.5))} ${f1(ay - 3.2 * Math.cos(a + 2.5))} L${f1(ax + 3.2 * Math.sin(a - 2.5))} ${f1(ay - 3.2 * Math.cos(a - 2.5))} Z" fill="${KAT_WARNA[k]}"/>`;
    g += `<rect x="44" y="${y - 10}" width="11" height="11" rx="2" fill="${KAT_WARNA[k]}"/>` + T(61, y, KAT_NAMA[k], { s: 10.5 }) + T(PPW - 18, y, `×${n} · terdekat ${jrk(d)}`, { s: 10, w: 600, a: 'end', c: d < 200 && ['in', 'rl', 'bd', 'ms', 'ps'].includes(k) ? C.bad : C.ink });
    y += 24;
  });
  g += T(16, 258, 'Panah = arah fasilitas terdekat dari tapak · radius 800 m (bandara 3 km)', { s: 8.5, c: C.sub });
  return kartu('SUMBER BISING & AKTIVITAS', g, 'OpenStreetMap');
}

function pKP(m, lk, H) {
  let g = '', y = 54;
  const daftar = (judul, warna, arr, maxY) => {
    g += `<rect x="16" y="${y - 9}" width="9" height="9" rx="2" fill="${warna}"/>` + T(31, y - 1, judul, { s: 11.3, w: 700, c: warna }); y += 14;
    if (!arr.length) { g += T(18, y, '— tidak ada yang menonjol dari data', { s: 9.8, c: C.sub }); y += 14; return; }
    for (const s of arr) { const ls = potong(s, 62).slice(0, 2); if (y + ls.length * 11.5 > maxY) break; ls.forEach((l, i) => { g += T(i ? 30 : 18, y, (i ? '' : '• ') + l, { s: 9.7 }); y += 11.5; }); y += 3; }
  };
  daftar('PELUANG', C.ok, H.kp.peluang, 150); y = Math.max(y, 156);
  daftar('KENDALA', C.bad, H.kp.kendala, 264);
  return kartu('KENDALA & PELUANG', g);
}

function pSkor(m, lk, H) {
  const S = H.skor; if (S.total == null) return takAda('SKOR KELAYAKAN LOKASI', 'data belum cukup untuk skor — lengkapi lewat "Analisis ulang"');
  const wc = S.total >= 78 ? C.ok : S.total >= 65 ? '#8a9f4f' : S.total >= 50 ? C.warn : C.bad;
  let g = T(70, 96, S.total, { s: 44, w: 800, a: 'middle', c: wc }) + T(70, 114, 'dari 100', { s: 9.5, a: 'middle', c: C.sub }) + T(70, 134, S.label, { s: 10.5, w: 700, a: 'middle', c: wc });
  potong(`${S.n} dari 6 faktor terhitung`, 26).forEach((l, i) => { g += T(70, 150 + i * 11, l, { s: 8.6, a: 'middle', c: C.sub }); });
  let y = 56;
  S.faktor.forEach(f => {
    const col = f.s == null ? '#d8d2c0' : f.s >= 78 ? C.ok : f.s >= 60 ? '#8a9f4f' : f.s >= 45 ? C.warn : C.bad;
    g += T(140, y + 9, f.nm, { s: 10 }) + T(PPW - 16, y + 9, f.s == null ? '—' : f.s, { s: 10.3, w: 700, a: 'end' }) + `<rect x="140" y="${y + 13}" width="${PPW - 156}" height="6" rx="3" fill="#ece6d4"/>` + (f.s == null ? '' : `<rect x="140" y="${y + 13}" width="${f1((PPW - 156) * f.s / 100)}" height="6" rx="3" fill="${col}"/>`) + T(PPW - 16, y + 9, '', {});
    g += T(140 + (PPW - 156), y + 28, `bobot ${f.w}%`, { s: 7.6, a: 'end', c: C.sub });
    y += 33;
  });
  g += T(16, 258, 'Indikatif: bobot & ambang = asumsi; bukan pengganti survei lapangan.', { s: 8.6, c: C.sub });
  return kartu('SKOR KELAYAKAN LOKASI', g);
}

const TILES = [['lokasi', pLokasi], ['bangunan', pBangun], ['jalan', pJalan], ['matahari', pMatahari], ['angin', pAngin], ['air', pAir], ['topo', pTopo], ['iklim', pIklim], ['eko', pEko], ['aktif', pAktif], ['kp', pKP], ['skor', pSkor]];

// ---------- kartu untuk dialog & lembar gabungan ----------
export function panelsLokasi(m, lk) {
  const H = hitung(m, lk), t = teksLokasi(m, lk, H);
  const svg = inner => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${PPW} ${PPH}" width="${PPW}" height="${PPH}" font-family="Roboto, Arial, sans-serif">${inner}</svg>`;
  return TILES.map(([id, fn]) => ({ id, svg: svg(fn(m, lk, H)), teks: t[id] || [] }));
}

// bagian: 0 = semua (12 panel + implikasi), 1 = panel 1–6, 2 = panel 7–12 (untuk halaman PDF)
export function lembarLokasiSVG(m, lk, bagian = 0) {
  const H = hitung(m, lk), t = teksLokasi(m, lk, H);
  const GAP = 16, W = PPW * 2 + GAP * 3, kepala = bagian === 0 ? 66 : 8;
  const daftar = TILES.map(([, fn]) => fn(m, lk, H)), pilih = bagian === 1 ? daftar.slice(0, 6) : bagian === 2 ? daftar.slice(6) : daftar;
  let strip = '', stripH = 0;
  if (bagian === 0) {
    const bl = [['IMPLIKASI UNTUK DESAIN RBW', t.implikasi], ['CATATAN & BATASAN DATA', t.batasan]];
    let y = 26; strip += `<rect x="0.5" y="0.5" width="${W - GAP * 2 - 1}" height="__H__" rx="8" fill="#f4f0e1" stroke="${C.bingkai}"/>`;
    bl.forEach(([jd, arr]) => { strip += T(16, y, jd, { s: 13, w: 700 }); y += 8; arr.forEach(s => { potong(s, 136).forEach((l, i) => { y += 14; strip += T(i ? 28 : 16, y, (i ? '' : '• ') + l, { s: 10.6 }); }); y += 3; }); y += 18; });
    stripH = y - 4; strip = strip.replace('__H__', stripH);
  }
  const Ht = kepala + Math.ceil(pilih.length / 2) * (PPH + GAP) + GAP + (stripH ? stripH + GAP : 0);
  let g = `<rect width="${W}" height="${Ht}" fill="${C.bg}"/>`;
  if (bagian === 0) {
    g += T(GAP, 34, `Analisis Lokasi — ${m.name || 'Rumah Walet'}`, { s: 21, w: 800 });
    g += T(GAP, 52, `${lk.la}, ${lk.lo} · ${new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })} · data © OpenStreetMap & Open-Meteo · GedungWalet.com`, { s: 11, c: C.sub });
  }
  pilih.forEach((p, i) => { g += `<g transform="translate(${GAP + (i % 2) * (PPW + GAP)} ${kepala + Math.floor(i / 2) * (PPH + GAP)})">${p}</g>`; });
  if (stripH) g += `<g transform="translate(${GAP} ${kepala + Math.ceil(pilih.length / 2) * (PPH + GAP)})">${strip}</g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${Ht}" width="${W}" height="${Ht}" font-family="Roboto, Arial, sans-serif">${g}</svg>`;
}

// sanitasi ringkasan dari link (semua angka dipaksa bulat & terbatas)
export function bersihkanLokasi(o) {
  if (!o || typeof o !== 'object') return null;
  const la = +o.la, lo = +o.lo;
  if (!Number.isFinite(la) || !Number.isFinite(lo) || Math.abs(la) > 80 || Math.abs(lo) > 180) return null;
  const lk = { la: Math.round(la * 1e5) / 1e5, lo: Math.round(lo * 1e5) / 1e5, amb: {} };
  const a = o.amb && typeof o.amb === 'object' ? o.amb : {};
  const int = (v, lim) => (Number.isFinite(+v) ? clamp(Math.round(+v), -lim, lim) : 0);
  const pos = (v, hi) => (Number.isFinite(+v) ? clamp(Math.round(+v), 0, hi) : 0);
  const txt = (v, n) => String(v ?? '').replace(/[\u0000-\u001f<>]/g, '').slice(0, n);
  if (Array.isArray(a.rd)) lk.amb.rd = a.rd.slice(0, 10).map(w => (w && typeof w === 'object' ? { c: clamp(Math.round(+w.c) || 4, 1, 4), d: int(w.d, 5000), ...(w.b != null ? { b: pos(w.b, 359) } : {}), ...(typeof w.n === 'string' ? { n: txt(w.n, 26) } : {}), p: (Array.isArray(w.p) ? w.p : []).slice(0, 12).map(p => [int(p?.[0], 1200), int(p?.[1], 1200)]) } : null)).filter(w => w && w.p.length >= 2);
  const r16 = v => (Array.isArray(v) && v.length === 16 ? v.map(x => pos(x, 100)) : null);
  if (r16(a.wr)) { lk.amb.wr = r16(a.wr); lk.amb.ws = pos(a.ws, 400); if (r16(a.wh)) lk.amb.wh = r16(a.wh); if (r16(a.wk)) lk.amb.wk = r16(a.wk); }
  if (Array.isArray(a.el) && a.el.length === 49) lk.amb.el = a.el.map(v => int(v, 6000));
  if (a.ek && typeof a.ek === 'object') {
    lk.amb.ek = { air: pos(a.ek.air, 100), sawah: pos(a.ek.sawah, 100), hutan: pos(a.ek.hutan, 100), bangun: pos(a.ek.bangun, 100) };
    if (a.ek.sg && typeof a.ek.sg === 'object') lk.amb.ek.sg = { d: int(a.ek.sg.d, 5000), b: pos(a.ek.sg.b, 359), ...(typeof a.ek.sg.n === 'string' ? { n: txt(a.ek.sg.n, 26) } : {}) };
  }
  if (a.ik && typeof a.ik === 'object') {
    const m12 = (v, lo2, hi, dec) => (Array.isArray(v) && v.length === 12 ? v.map(x => (Number.isFinite(+x) ? Math.round(clamp(+x, lo2, hi) * 10 ** dec) / 10 ** dec : 0)) : null);
    const hj = m12(a.ik.hj, 0, 3000, 0), tx = m12(a.ik.tx, -20, 55, 1), tn = m12(a.ik.tn, -20, 55, 1), rh = m12(a.ik.rh, 0, 100, 0);
    if (hj && tx && tn && rh) lk.amb.ik = { hj, tx, tn, rh };
  }
  if (a.bg && typeof a.bg === 'object' && Array.isArray(a.bg.g) && a.bg.g.length === 25) {
    const b = a.bg;
    lk.amb.bg = { n: pos(b.n, 5000), p: pos(b.p, 100), dk: b.dk == null ? null : pos(b.dk, 1000), lv: pos(b.lv, 200), t3: pos(b.t3, 999), ...(b.dt != null ? { dt: pos(b.dt, 1000) } : {}), ...(b.c ? { c: 1 } : {}), g: b.g.map(s => (parseInt(String(s), 36) & 0x1ffffff).toString(36)) };
  }
  if (Array.isArray(a.po)) lk.amb.po = a.po.slice(0, 10).filter(r => Array.isArray(r) && Object.hasOwn(KAT_NAMA, r[0])).map(r => [r[0], pos(r[1], 999), pos(r[2], 6000), pos(r[3], 359)]);
  if (Array.isArray(a.tp)) lk.amb.tp = a.tp.slice(0, 8).filter(r => Array.isArray(r) && typeof r[0] === 'string' && 'ktdhs'.includes(String(r[3]) || 'x')).map(r => [txt(r[0], 24), pos(r[1], 9000), pos(r[2], 359), String(r[3])[0]]);
  return Object.keys(lk.amb).length ? lk : { la: lk.la, lo: lk.lo };
}
