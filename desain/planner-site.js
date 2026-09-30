// Analisis lokasi (site analysis) untuk tab "Presentasi": pengguna menempel titik Google Maps
// (link atau koordinat), lalu data lingkungan diambil dari sumber TERBUKA GRATIS —
// jalan & tutupan lahan © OpenStreetMap (Overpass API), angin setahun & elevasi dari Open-Meteo —
// dan dirangkum jadi lembar panel ala diagram arsitek: akses jalan (kebisingan), jalur matahari,
// mawar angin, topografi, dan ekologi, masing-masing dengan bacaan khusus rumah walet.
// Ringkasan (m.lokasi.amb) sengaja kecil & berupa angka bulat supaya ikut tersimpan di link desain.
import { ARAH8, RULES, SUARA } from './planner-data.js?v=20260930';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const f1 = n => Math.round(n * 10) / 10;
const fmt = n => (+n).toLocaleString('id-ID');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const RAD = Math.PI / 180;
const arahNama = b => ARAH8.reduce((x, a) => (Math.abs(((b - a[0] + 540) % 360) - 180) > Math.abs(((b - x[0] + 540) % 360) - 180) ? x : a))[1];

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

// meter timur (x) & utara (y) dari titik pusat
const keMeter = (la0, lo0, lat, lon) => [ (lon - lo0) * 111320 * Math.cos(la0 * RAD), (lat - la0) * 110540 ];

// ---------- pengambilan data (tiap sumber terpisah; gagal satu tidak menggagalkan lainnya) ----------
const ambil = async (url, opt, timeout = 30000) => {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), timeout);
  try { const r = await fetch(url, { ...opt, signal: ac.signal }); if (!r.ok) throw new Error('HTTP ' + r.status); return await r.json(); }
  finally { clearTimeout(t); }
};

// Beberapa cermin Overpass dicoba berurutan — jaringan/waktu tertentu menolak salah satunya (406/429/504).
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
async function osm(la, lo) {
  const q = `[out:json][timeout:25];(way(around:500,${la},${lo})[highway];way(around:1000,${la},${lo})[landuse];way(around:1000,${la},${lo})[natural];way(around:1000,${la},${lo})[waterway];);out geom 500;`;
  let j = null, terakhir = null;
  for (const url of [...OVERPASS, ...OVERPASS]) {   // dua putaran — 504/429 sering hanya sesaat
    try { j = await ambil(url, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }, 30000); break; }
    catch (e) { terakhir = e; console.warn('overpass gagal:', url, e?.message || e); }
  }
  if (!j) throw terakhir || new Error('semua server Overpass gagal');
  const KELAS = { motorway: 1, trunk: 1, primary: 1, motorway_link: 1, trunk_link: 1, primary_link: 1, secondary: 2, secondary_link: 2, tertiary: 3, tertiary_link: 3, unclassified: 3, road: 3, residential: 4, living_street: 4, service: 4, track: 4 };
  const rd = [], areas = { air: 0, sawah: 0, hutan: 0, bangun: 0 };
  let sg = null;
  (j.elements || []).forEach(e => {
    if (!Array.isArray(e.geometry) || e.geometry.length < 2) return;
    const pts = e.geometry.map(g => keMeter(la, lo, g.lat, g.lon));
    const tg = e.tags || {};
    if (tg.highway && KELAS[tg.highway]) {
      const d = Math.round(Math.min(...pts.map(p => Math.hypot(p[0], p[1]))));
      const langkah = Math.max(1, Math.ceil(pts.length / 10));
      rd.push({ c: KELAS[tg.highway], d, ...(tg.name ? { n: String(tg.name).slice(0, 26) } : {}), p: pts.filter((_, i) => i % langkah === 0 || i === pts.length - 1).map(p => [Math.round(p[0] / 5) * 5, Math.round(p[1] / 5) * 5]) });
    } else if (tg.waterway && ['river', 'stream', 'canal'].includes(tg.waterway)) {
      const i = pts.reduce((b, p, k) => (Math.hypot(p[0], p[1]) < Math.hypot(pts[b][0], pts[b][1]) ? k : b), 0);
      const d = Math.round(Math.hypot(pts[i][0], pts[i][1])), b = Math.round((Math.atan2(pts[i][0], pts[i][1]) / RAD + 360) % 360);
      if (!sg || d < sg.d) sg = { d, b, ...(tg.name ? { n: String(tg.name).slice(0, 26) } : {}) };
    } else {
      const kat = tg.natural === 'water' || tg.landuse === 'basin' || tg.landuse === 'reservoir' || tg.natural === 'wetland' ? 'air'
        : tg.landuse === 'forest' || tg.natural === 'wood' || tg.natural === 'scrub' ? 'hutan'
        : ['farmland', 'orchard', 'meadow', 'farmyard', 'greenhouse_horticulture'].includes(tg.landuse) || tg.natural === 'grassland' ? 'sawah'
        : ['residential', 'industrial', 'commercial', 'retail'].includes(tg.landuse) ? 'bangun' : null;
      if (!kat) return;
      let A = 0;   // shoelace (m²)
      for (let i = 0; i < pts.length - 1; i++) A += pts[i][0] * pts[i + 1][1] - pts[i + 1][0] * pts[i][1];
      areas[kat] += Math.abs(A) / 2;
    }
  });
  rd.sort((a, b) => a.c - b.c || a.d - b.d);
  const CIRC = Math.PI * 1e6;
  const ek = Object.fromEntries(Object.entries(areas).map(([k, v]) => [k, clamp(Math.round((100 * v) / CIRC), 0, 100)]));
  if (sg) ek.sg = sg;
  return { rd: rd.slice(0, 10), ek };
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
  return el;
}

async function angin(la, lo) {
  const d2 = new Date(Date.now() - 3 * 864e5), d1 = new Date(d2 - 362 * 864e5), iso = d => d.toISOString().slice(0, 10);
  const j = await ambil(`https://archive-api.open-meteo.com/v1/archive?latitude=${la}&longitude=${lo}&start_date=${iso(d1)}&end_date=${iso(d2)}&daily=wind_speed_10m_max,wind_direction_10m_dominant&wind_speed_unit=ms&timezone=auto`, {}, 40000);
  const dir = j.daily?.wind_direction_10m_dominant || [], spd = j.daily?.wind_speed_10m_max || [];
  const wr = Array(16).fill(0); const sp = [];
  dir.forEach((d, i) => { const v = +spd[i]; if (!Number.isFinite(+d) || !Number.isFinite(v)) return; wr[Math.round(+d / 22.5) % 16] += v; sp.push(v); });
  const tot = wr.reduce((a, b) => a + b, 0) || 1;
  sp.sort((a, b) => a - b);
  if (!sp.length) throw new Error('data angin kosong');
  return { wr: wr.map(v => Math.round((100 * v) / tot)), ws: Math.round(sp[Math.floor(sp.length / 2)] * 10) };
}

// prog(teks) melaporkan tahap; hasil = ringkasan kecil yang aman disimpan di model & link.
// punya = amb lama untuk titik yang SAMA → sumber yang sudah ada tidak diambil ulang (hemat kuota server).
export async function ambilData(la, lo, prog = () => {}, punya = null) {
  const amb = { ...(punya || {}) }, gagal = [];
  delete amb.gagal;
  if (!(amb.rd && amb.ek)) {
    prog('Mengambil jalan, lahan & sungai (OpenStreetMap)…');
    try { Object.assign(amb, await osm(la, lo)); } catch (e) { gagal.push('jalan/lahan'); console.warn('OSM', e); }
  }
  if (!amb.el) {
    prog('Mengambil elevasi 7×7 titik (Open-Meteo)…');
    try { amb.el = await elevasi(la, lo); } catch (e) { gagal.push('topografi'); console.warn('elevasi', e); }
  }
  if (!amb.wr) {
    prog('Merangkum angin 12 bulan (Open-Meteo)…');
    try { Object.assign(amb, await angin(la, lo)); } catch (e) { gagal.push('angin'); console.warn('angin', e); }
  }
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

// ---------- panel-panel (SVG 380×272, gaya kertas hangat ala lembar arsitek) ----------
const PPW = 380, PPH = 272;
const C = { bg: '#fbf8f0', kartu: '#fdfbf5', bingkai: '#ddd6c4', ink: '#4a4636', sub: '#8a8171', sage: '#a9b78f', tapak: '#7c8f5f', air: '#8fb7cc', sawah: '#c9d69b', hutan: '#7f9f6b', bangun: '#b8ab97', mth: '#dd9c33' };
const ROADC = { 1: '#565b4e', 2: '#767b6c', 3: '#989e8d', 4: '#c0c5b5' };
const kartu = (judul, isi, sub2 = '') =>
  `<g><rect x="0.5" y="0.5" width="${PPW - 1}" height="${PPH - 1}" rx="8" fill="${C.kartu}" stroke="${C.bingkai}"/>` +
  `<text x="16" y="26" font-size="14.5" font-weight="700" fill="${C.ink}" letter-spacing=".4">${esc(judul)}</text>` +
  (sub2 ? `<text x="${PPW - 16}" y="26" text-anchor="end" font-size="10.5" fill="${C.sub}">${esc(sub2)}</text>` : '') +
  `<line x1="16" y1="34" x2="${PPW - 16}" y2="34" stroke="${C.bingkai}"/>${isi}</g>`;
const takAda = judul => kartu(judul, `<text x="${PPW / 2}" y="${PPH / 2 + 10}" text-anchor="middle" font-size="12" fill="${C.sub}">data tidak tersedia (coba Analisis ulang)</text>`);

function pJalan(lk) {
  const rd = lk.amb?.rd; if (!rd?.length) return takAda('AKSES & JALAN (KEBISINGAN)');
  const cx = 150, cy = 158, rp = 106, sk = rp / 500;
  let g = `<defs><clipPath id="lkj"><circle cx="${cx}" cy="${cy}" r="${rp}"/></clipPath></defs>`;
  g += `<circle cx="${cx}" cy="${cy}" r="${rp}" fill="#f3efe2" stroke="${C.bingkai}"/><circle cx="${cx}" cy="${cy}" r="${rp / 2}" fill="none" stroke="${C.bingkai}" stroke-dasharray="3 4"/>`;
  g += `<g clip-path="url(#lkj)">` + rd.slice().reverse().map(w => `<polyline points="${w.p.map(p => `${f1(cx + p[0] * sk)},${f1(cy - p[1] * sk)}`).join(' ')}" fill="none" stroke="${ROADC[w.c]}" stroke-width="${w.c === 1 ? 5 : w.c === 2 ? 3.6 : w.c === 3 ? 2.5 : 1.7}" stroke-linecap="round" stroke-linejoin="round"/>`).join('') + '</g>';
  g += `<rect x="${cx - 5}" y="${cy - 5}" width="10" height="10" fill="${C.tapak}" stroke="#fff" stroke-width="1.2"/>`;
  g += `<text x="${cx}" y="${cy + rp + 14}" text-anchor="middle" font-size="9.5" fill="${C.sub}">radius 500 m</text>`;
  const dkt = rd[0], { tingkat } = nilaiBising(rd);
  const wc = tingkat === 'Tinggi' ? '#b3563f' : tingkat === 'Sedang' ? '#c08a2e' : '#6f8f5a';
  let y = 58;
  g += `<text x="268" y="${y}" font-size="10.5" fill="${C.sub}">Perkiraan bising</text><text x="268" y="${y + 17}" font-size="15" font-weight="700" fill="${wc}">${tingkat}</text>`;
  y += 40;
  rd.slice(0, 4).forEach(w => { g += `<line x1="268" y1="${y - 4}" x2="284" y2="${y - 4}" stroke="${ROADC[w.c]}" stroke-width="${w.c === 1 ? 4.5 : w.c === 2 ? 3.2 : 2.2}"/><text x="289" y="${y}" font-size="9.3" fill="${C.ink}">${esc((w.n || ['jln besar', 'jln besar', 'jln sedang', 'jln kecil'][w.c - 1]).replace(/^Jalan /, 'Jl. ').slice(0, 16))} · ${w.d} m</text>`; y += 17; });
  return kartu('AKSES & JALAN (KEBISINGAN)', g, `terdekat ±${dkt.d} m`);
}
function nilaiBising(rd) {
  const nd = Math.min(...rd.map(w => w.d * (w.c === 1 ? 1 : w.c === 2 ? 1.7 : w.c === 3 ? 2.8 : 4.5)), 1e4);
  return { tingkat: nd < 180 ? 'Tinggi' : nd < 430 ? 'Sedang' : 'Rendah', nd };
}

function pMatahari(m, lk) {
  const cx = 190, cy = 156, R = 104, la = lk.la;
  let g = `<circle cx="${cx}" cy="${cy}" r="${R}" fill="#f6f2e4" stroke="${C.bingkai}"/>`;
  [['U', 0, -1], ['T', 1, 0], ['S', 0, 1], ['B', -1, 0]].forEach(([t, dx, dy]) => { g += `<text x="${cx + dx * (R + 11)}" y="${cy + dy * (R + 11) + 4}" text-anchor="middle" font-size="11" font-weight="600" fill="${C.sub}">${t}</text>`; });
  const arcs = [[172, '21 Jun', '#d9a441'], [80, 'Ekuinoks', '#cc8f2f'], [355, '21 Des', '#bf7c28']];
  arcs.forEach(([n, nm, col]) => {
    const pts = [];
    for (let j = 5.5; j <= 18.5; j += 0.25) { const s = matahari(la, n, j); if (s.alt <= 0) continue; const r = ((90 - s.alt) / 90) * R, a = (s.az - 90) * RAD; pts.push(`${f1(cx + r * Math.cos(a))},${f1(cy + r * Math.sin(a))}`); }
    if (pts.length > 1) g += `<polyline points="${pts.join(' ')}" fill="none" stroke="${col}" stroke-width="1.6" stroke-dasharray="${nm === 'Ekuinoks' ? '' : '5 3'}"/>`;
  });
  for (const j of [6, 9, 12, 15, 18]) { const s = matahari(la, 80, j); if (s.alt <= 0) continue; const r = ((90 - s.alt) / 90) * R, a = (s.az - 90) * RAD, x = cx + r * Math.cos(a), y = cy + r * Math.sin(a);
    g += `<circle cx="${f1(x)}" cy="${f1(y)}" r="5" fill="${C.mth}" stroke="#fff"/><text x="${f1(x)}" y="${f1(y - 8)}" text-anchor="middle" font-size="8.5" fill="${C.sub}">${j}</text>`; }
  const hd = (m.sim?.hadap ?? 0) * RAD;   // tapak gedung: sisi depan menghadap kompas 'hadap'
  g += `<g transform="translate(${cx} ${cy}) rotate(${f1((m.sim?.hadap ?? 0))})"><rect x="-13" y="-8" width="26" height="16" fill="${C.tapak}" fill-opacity=".9" stroke="#fff"/><path d="M0 -8 L0 -20 M-4 -15 L0 -20 L4 -15" stroke="${C.tapak}" fill="none" stroke-width="1.6"/></g>`;
  let y2 = 56;
  [['— 21 Jun', '#d9a441'], ['— Ekuinoks', '#cc8f2f'], ['— 21 Des', '#bf7c28']].forEach(([t, col]) => { g += `<text x="300" y="${y2}" font-size="9.8" fill="${col}" font-weight="600">${t}</text>`; y2 += 15; });
  g += `<text x="300" y="${y2 + 4}" font-size="9.3" fill="${C.sub}">panah = hadap</text>`;
  return kartu('JALUR MATAHARI', g, `lintang ${f1(la)}°`);
}

function pAngin(lk) {
  const wr = lk.amb?.wr; if (!wr) return takAda('ANGIN (12 BULAN)');
  const cx = 150, cy = 158, R = 100, mx = Math.max(...wr, 1);
  let g = `<circle cx="${cx}" cy="${cy}" r="${R}" fill="#f6f2e4" stroke="${C.bingkai}"/><circle cx="${cx}" cy="${cy}" r="${R / 2}" fill="none" stroke="${C.bingkai}" stroke-dasharray="3 4"/>`;
  const dom = wr.indexOf(Math.max(...wr));
  wr.forEach((v, i) => {
    const a = i * 22.5 * RAD, w2 = 9 * RAD, r = (v / mx) * (R - 8);
    const p = k => `${f1(cx + r * Math.sin(a + k))},${f1(cy - r * Math.cos(a + k))}`;
    g += `<polygon points="${cx},${cy} ${p(-w2)} ${f1(cx + r * 1.06 * Math.sin(a))},${f1(cy - r * 1.06 * Math.cos(a))} ${p(w2)}" fill="${i === dom ? '#6f8f5a' : C.sage}" fill-opacity="${i === dom ? 0.95 : 0.55}" stroke="#fff" stroke-width="0.6"/>`;
  });
  [['U', 0], ['T', 90], ['S', 180], ['B', 270]].forEach(([t, b]) => { const a = b * RAD; g += `<text x="${f1(cx + (R + 11) * Math.sin(a))}" y="${f1(cy - (R + 11) * Math.cos(a) + 4)}" text-anchor="middle" font-size="11" font-weight="600" fill="${C.sub}">${t}</text>`; });
  let y = 60;
  g += `<text x="268" y="${y}" font-size="10.5" fill="${C.sub}">Dominan dari</text><text x="268" y="${y + 18}" font-size="14" font-weight="700" fill="${C.ink}">${arahNama(dom * 22.5)}</text>`;
  g += `<text x="268" y="${y + 40}" font-size="10.5" fill="${C.sub}">Maks harian tipikal</text><text x="268" y="${y + 58}" font-size="14" font-weight="700" fill="${C.ink}">${f1((lk.amb.ws || 0) / 10)} m/s</text>`;
  return kartu('ANGIN (12 BULAN)', g, 'mawar angin harian');
}

function pTopo(lk) {
  const el = lk.amb?.el; if (!el?.length) return takAda('TOPOGRAFI');
  const x0 = 26, y0 = 52, cell = 27;
  const mn = Math.min(...el), mxv = Math.max(...el), rng = Math.max(1, mxv - mn);
  const warna = v => { const t = (v - mn) / rng; const mix = (a, b) => Math.round(a + (b - a) * t); return `rgb(${mix(169, 138)},${mix(192, 111)},${mix(138, 77)})`; };
  let g = '';
  for (let r = 0; r < 7; r++) for (let c = 0; c < 7; c++) {
    const v = el[r * 7 + c];
    g += `<rect x="${x0 + c * cell}" y="${y0 + r * cell}" width="${cell}" height="${cell}" fill="${warna(v)}" fill-opacity=".82"/>`;
    const kanan = c < 6 && Math.round((el[r * 7 + c + 1] - mn) / rng * 4) !== Math.round((v - mn) / rng * 4);
    const bawah = r < 6 && Math.round((el[(r + 1) * 7 + c] - mn) / rng * 4) !== Math.round((v - mn) / rng * 4);
    if (kanan) g += `<line x1="${x0 + (c + 1) * cell}" y1="${y0 + r * cell}" x2="${x0 + (c + 1) * cell}" y2="${y0 + (r + 1) * cell}" stroke="#6d6350" stroke-width="0.9"/>`;
    if (bawah) g += `<line x1="${x0 + c * cell}" y1="${y0 + (r + 1) * cell}" x2="${x0 + (c + 1) * cell}" y2="${y0 + (r + 1) * cell}" stroke="#6d6350" stroke-width="0.9"/>`;
  }
  g += `<rect x="${x0}" y="${y0}" width="${7 * cell}" height="${7 * cell}" fill="none" stroke="${C.bingkai}"/>`;
  g += `<rect x="${x0 + 3 * cell + 6}" y="${y0 + 3 * cell + 6}" width="${cell - 12}" height="${cell - 12}" fill="${C.tapak}" stroke="#fff"/>`;
  const { b: arahT } = arahTurun(el);
  const ax = x0 + 7 * cell + 34, ay = y0 + 44, ar = 22, aa = arahT * RAD;
  g += `<circle cx="${ax}" cy="${ay}" r="${ar + 6}" fill="#f6f2e4" stroke="${C.bingkai}"/><path d="M${f1(ax - ar * Math.sin(aa))} ${f1(ay + ar * Math.cos(aa))} L${f1(ax + ar * Math.sin(aa))} ${f1(ay - ar * Math.cos(aa))}" stroke="#8a6f4d" stroke-width="2"/><path d="M${f1(ax + ar * Math.sin(aa))} ${f1(ay - ar * Math.cos(aa))} l${f1(-7 * Math.sin(aa + 0.5))} ${f1(7 * Math.cos(aa + 0.5))} m${f1(7 * Math.sin(aa + 0.5))} ${f1(-7 * Math.cos(aa + 0.5))} l${f1(-7 * Math.sin(aa - 0.5))} ${f1(7 * Math.cos(aa - 0.5))}" stroke="#8a6f4d" stroke-width="2" fill="none"/>`;
  g += `<text x="${ax}" y="${ay + ar + 22}" text-anchor="middle" font-size="9.5" fill="${C.sub}">arah turun</text><text x="${ax}" y="${ay + ar + 35}" text-anchor="middle" font-size="10.5" font-weight="600" fill="${C.ink}">${arahNama(arahT)}</text>`;
  g += `<text x="${ax}" y="${ay + ar + 58}" text-anchor="middle" font-size="9.5" fill="${C.sub}">elevasi</text><text x="${ax}" y="${ay + ar + 72}" text-anchor="middle" font-size="10.5" font-weight="600" fill="${C.ink}">${mn}–${mxv} mdpl</text>`;
  return kartu('TOPOGRAFI', g, `±450 m · beda ${rng} m`);
}
function arahTurun(el) {
  let gx = 0, gy = 0;   // gradien rata-rata: + = naik ke timur/utara
  for (let r = 0; r < 7; r++) for (let c = 0; c < 6; c++) gx += el[r * 7 + c + 1] - el[r * 7 + c];
  for (let r = 0; r < 6; r++) for (let c = 0; c < 7; c++) gy += el[r * 7 + c] - el[(r + 1) * 7 + c];   // baris 0 = utara
  const b = (Math.atan2(-gx, -gy) / RAD + 360) % 360;   // arah TURUN (kompas)
  return { b: Math.round(b), gx, gy };
}

function pEko(lk) {
  const ek = lk.amb?.ek; if (!ek) return takAda('EKOLOGI (RADIUS 1 KM)');
  const item = [['air', 'Air / rawa', C.air], ['sawah', 'Sawah / kebun', C.sawah], ['hutan', 'Hutan / semak', C.hutan], ['bangun', 'Permukiman', C.bangun]];
  const cx = 92, cy = 150, R = 68, r2 = 40;
  const tot = Math.max(1, item.reduce((s, [k]) => s + (ek[k] || 0), 0));
  let a0 = -Math.PI / 2, g = `<circle cx="${cx}" cy="${cy}" r="${R}" fill="#f3efe2" stroke="${C.bingkai}"/>`;
  item.forEach(([k, , col]) => {
    const v = ek[k] || 0; if (!v) return;
    const a1 = a0 + 2 * Math.PI * (v / Math.max(tot, 100));
    const big = a1 - a0 > Math.PI ? 1 : 0;
    g += `<path d="M${f1(cx + R * Math.cos(a0))} ${f1(cy + R * Math.sin(a0))} A${R} ${R} 0 ${big} 1 ${f1(cx + R * Math.cos(a1))} ${f1(cy + R * Math.sin(a1))} L${f1(cx + r2 * Math.cos(a1))} ${f1(cy + r2 * Math.sin(a1))} A${r2} ${r2} 0 ${big} 0 ${f1(cx + r2 * Math.cos(a0))} ${f1(cy + r2 * Math.sin(a0))} Z" fill="${col}" stroke="#fff" stroke-width="1"/>`;
    a0 = a1;
  });
  g += `<circle cx="${cx}" cy="${cy}" r="4.5" fill="${C.tapak}" stroke="#fff"/>`;
  let y = 62;
  item.forEach(([k, nm, col]) => { g += `<rect x="196" y="${y - 10}" width="12" height="12" rx="2" fill="${col}"/><text x="214" y="${y}" font-size="10.5" fill="${C.ink}">${nm}</text><text x="${PPW - 18}" y="${y}" text-anchor="end" font-size="10.5" font-weight="700" fill="${C.ink}">${ek[k] || 0}%</text>`; y += 22; });
  if (ek.sg) { const nmS = ek.sg.n ? (/^(sungai|kali|krueng|batang)\b/i.test(ek.sg.n) ? ek.sg.n : 'Sungai ' + ek.sg.n) : 'Sungai'; g += `<text x="196" y="${y + 6}" font-size="10" fill="${C.sub}">${esc(nmS)} ±${ek.sg.d} m</text><text x="196" y="${y + 20}" font-size="10" fill="${C.sub}">arah ${arahNama(ek.sg.b)}</text>`; }
  g += `<text x="${cx}" y="${cy + R + 16}" text-anchor="middle" font-size="9.5" fill="${C.sub}">bagian terpetakan OSM</text>`;
  return kartu('EKOLOGI (RADIUS 1 KM)', g);
}

// ---------- teks bacaan khusus rumah walet ----------
export function teksLokasi(m, lk) {
  const t = { jalan: [], matahari: [], angin: [], topo: [], eko: [], saran: [] }, amb = lk.amb || {};
  if (amb.rd?.length) {
    const { tingkat } = nilaiBising(amb.rd), dkt = amb.rd[0];
    t.jalan.push(`Jalan terdekat ±${dkt.d} m (${dkt.n || 'tanpa nama'}) — perkiraan kebisingan ${tingkat.toLowerCase()}.`);
    t.jalan.push(tingkat === 'Tinggi' ? 'Cukup bising: letakkan LMB & void menjauh dari sisi jalan, pakai dinding/sekat bata di sisi jalan, dan naikkan sedikit volume tarik agar tetap terdengar.' : tingkat === 'Sedang' ? 'Bising sedang: aman untuk RBW; hindari LMB tepat menghadap jalan bila bisa.' : 'Lokasi tenang — baik untuk walet; volume suara mengikuti tabel buku.');
    if (tingkat === 'Tinggi') t.saran.push('Sisi jalan: dinding bata + LMB menjauh dari jalan (bising).');
  }
  t.matahari.push(`Matahari condong ${lk.la <= 0 ? 'ke utara saat Juni & ke selatan saat Desember' : 'ke selatan saat Desember & ke utara saat Juni'}; sore hari selalu di barat.`);
  t.matahari.push('Dinding barat paling panas kena sinar sore — jangan tempatkan ruang inap menempel dinding barat tanpa peneduh; LMB gelap tetap dicat hitam.');
  t.saran.push('Dinding barat kena panas sore — cek suhu di "Cek udara" (sol-air).');
  if (amb.wr) {
    const dom = amb.wr.indexOf(Math.max(...amb.wr)), nm = arahNama(dom * 22.5), ws = (amb.ws || 0) / 10;
    t.angin.push(`Angin setahun dominan dari ${nm}, kecepatan tipikal ${f1(ws)} m/s.`);
    t.angin.push(ws >= 6 ? 'Angin cukup kencang: jangan hadapkan ventilasi lurus ke arah ini (buku: hindari ventilasi menghadap angin laut kencang); LMB jangan melawan angin kencang.' : 'Angin normal — ventilasi silang aman; manfaatkan untuk pertukaran udara.');
    t.saran.push(`Atur "Angin dari" simulasi = sisi ${nm.toLowerCase()} (tombol Terapkan).`);
  }
  if (amb.el) {
    const mn = Math.min(...amb.el), mx = Math.max(...amb.el), rng = mx - mn, { b } = arahTurun(amb.el);
    t.topo.push(`Elevasi ${mn}–${mx} mdpl; beda ${rng} m dalam ±450 m — lahan ${rng < 3 ? 'datar' : rng < 10 ? 'landai' : 'berbukit'}; air mengalir ke ${arahNama(b).toLowerCase()}.`);
    t.topo.push(rng < 3 ? 'Lahan datar: pastikan drainase & lantai dasar ditinggikan bila dekat sungai/rawa (risiko genangan).' : 'Ada kemiringan: letakkan pintu & ruang audio di sisi atas; alirkan drainase mengikuti arah turun.');
    if (rng < 3 && amb.ek?.sg && amb.ek.sg.d < 400) t.saran.push('Datar & dekat sungai — tinggikan lantai dasar (genangan).');
  }
  if (amb.ek) {
    const ek = amb.ek, dom = [['air', ek.air || 0], ['sawah', ek.sawah || 0], ['hutan', ek.hutan || 0], ['bangun', ek.bangun || 0]].sort((a, b) => b[1] - a[1])[0];
    const env = envDari(ek);
    t.eko.push(`Sekitar 1 km: air ${ek.air || 0}%, sawah/kebun ${ek.sawah || 0}%, hutan ${ek.hutan || 0}%, permukiman ${ek.bangun || 0}%${ek.sg ? `; sungai ±${ek.sg.d} m` : ''}.`);
    t.eko.push(`Dominan ${dom[0] === 'bangun' ? 'permukiman' : dom[0]} → profil suara "${SUARA[env].label}" (panggil ${SUARA[env].panggil}).`);
    t.eko.push(env === 'kota' ? 'Sumber pakan (serangga) terbatas — pastikan ada sawah/rawa dalam radius terbang; populasi sekitar menentukan.' : 'Sumber pakan serangga baik (sawah/air/hutan dekat).');
    t.saran.push(`Lingkungan condong "${SUARA[env].label}" — terapkan profil suaranya (tombol Terapkan).`);
  }
  if (amb.gagal?.length) t.saran.push(`Data ${amb.gagal.join(', ')} belum terambil — coba "Analisis" lagi.`);
  return t;
}
const envDari = ek => ((ek.air || 0) >= 8 || (ek.sg && ek.sg.d < 350) ? 'air' : (ek.sawah || 0) + (ek.hutan || 0) >= Math.max(10, ek.bangun || 0) ? 'sawah' : 'kota');

// terapkan hasil ke pengaturan simulasi & pengamatan; kembalikan daftar perubahan (teks)
export function terapkanLokasi(m, lk) {
  const amb = lk.amb || {}, ubah = [];
  m.sim = m.sim || {};
  if (amb.wr) {
    const dom = amb.wr.indexOf(Math.max(...amb.wr)) * 22.5, rel = ((dom - (m.sim.hadap ?? 0)) % 360 + 360) % 360;
    const sisi = rel < 45 || rel >= 315 ? 'depan' : rel < 135 ? 'kanan' : rel < 225 ? 'belakang' : 'kiri';
    m.sim.anginDari = sisi; m.sim.anginKec = clamp(Math.round((amb.ws || 20) / 10 * 0.7), 1, 12);
    ubah.push(`Angin simulasi: dari sisi ${sisi}, ${m.sim.anginKec} m/s (dominan ${arahNama(dom)})`);
  }
  if (amb.ek) {
    const env = envDari(amb.ek);
    m.survey = { ...(m.survey || {}), env };
    ubah.push(`Lingkungan pengamatan: ${SUARA[env].label} (profil suara & target dB ikut berubah)`);
  }
  return ubah;
}

// ---------- kartu untuk dialog & lembar gabungan ----------
export function panelsLokasi(m, lk) {
  const svg = inner => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${PPW} ${PPH}" width="${PPW}" height="${PPH}" font-family="Roboto, Arial, sans-serif">${inner}</svg>`;
  const t = teksLokasi(m, lk);
  return [
    { id: 'jalan', svg: svg(pJalan(lk)), teks: t.jalan },
    { id: 'matahari', svg: svg(pMatahari(m, lk)), teks: t.matahari },
    { id: 'angin', svg: svg(pAngin(lk)), teks: t.angin },
    { id: 'topo', svg: svg(pTopo(lk)), teks: t.topo },
    { id: 'eko', svg: svg(pEko(lk)), teks: t.eko },
  ];
}

export function lembarLokasiSVG(m, lk) {
  const GAP = 16, W = PPW * 2 + GAP * 3, kepala = 66;
  const t = teksLokasi(m, lk);
  const panels = [pJalan(lk), pMatahari(m, lk), pAngin(lk), pTopo(lk), pEko(lk)];
  let saran = `<text x="16" y="26" font-size="14.5" font-weight="700" fill="${C.ink}">KESIMPULAN UNTUK RBW</text><line x1="16" y1="34" x2="${PPW - 16}" y2="34" stroke="${C.bingkai}"/>`;
  let sy = 54;
  t.saran.slice(0, 6).forEach(s => { const ls = potong(s, 52); ls.slice(0, 2).forEach((l, i) => { saran += `<text x="${i ? 30 : 18}" y="${sy}" font-size="10.8" fill="${C.ink}">${i ? '' : '• '}${esc(l)}${i === 1 && ls.length > 2 ? '…' : ''}</text>`; sy += 15; }); sy += 3; });
  saran = `<g><rect x="0.5" y="0.5" width="${PPW - 1}" height="${PPH - 1}" rx="8" fill="#f4f0e1" stroke="${C.bingkai}"/>${saran}</g>`;
  panels.push(saran);
  const H = kepala + Math.ceil(panels.length / 2) * (PPH + GAP) + GAP;
  let g = `<rect width="${W}" height="${H}" fill="${C.bg}"/>`;
  g += `<text x="${GAP}" y="34" font-size="21" font-weight="800" fill="${C.ink}">Analisis Lokasi — ${esc(m.name || 'Rumah Walet')}</text>`;
  g += `<text x="${GAP}" y="52" font-size="11" fill="${C.sub}">${lk.la}, ${lk.lo} · ${new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })} · data © OpenStreetMap &amp; Open-Meteo · GedungWalet.com</text>`;
  panels.forEach((p, i) => { g += `<g transform="translate(${GAP + (i % 2) * (PPW + GAP)} ${kepala + Math.floor(i / 2) * (PPH + GAP)})">${p}</g>`; });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="Roboto, Arial, sans-serif">${g}</svg>`;
}
const potong = (s, n) => { const out = []; let cur = ''; String(s).split(' ').forEach(w => { if ((cur + ' ' + w).trim().length > n && cur) { out.push(cur); cur = w; } else cur = (cur ? cur + ' ' : '') + w; }); if (cur) out.push(cur); return out; };

// sanitasi ringkasan dari link (semua angka dipaksa bulat & terbatas)
export function bersihkanLokasi(o) {
  if (!o || typeof o !== 'object') return null;
  const la = +o.la, lo = +o.lo;
  if (!Number.isFinite(la) || !Number.isFinite(lo) || Math.abs(la) > 80 || Math.abs(lo) > 180) return null;
  const lk = { la: Math.round(la * 1e5) / 1e5, lo: Math.round(lo * 1e5) / 1e5, amb: {} };
  const a = o.amb && typeof o.amb === 'object' ? o.amb : {};
  const int = (v, lim) => (Number.isFinite(+v) ? clamp(Math.round(+v), -lim, lim) : 0);
  if (Array.isArray(a.rd)) lk.amb.rd = a.rd.slice(0, 10).map(w => (w && typeof w === 'object' ? { c: clamp(Math.round(+w.c) || 4, 1, 4), d: int(w.d, 5000), ...(typeof w.n === 'string' ? { n: w.n.slice(0, 26) } : {}), p: (Array.isArray(w.p) ? w.p : []).slice(0, 12).map(p => [int(p?.[0], 1200), int(p?.[1], 1200)]) } : null)).filter(w => w && w.p.length >= 2);
  if (Array.isArray(a.wr) && a.wr.length === 16) { lk.amb.wr = a.wr.map(v => clamp(Math.round(+v) || 0, 0, 100)); lk.amb.ws = clamp(Math.round(+a.ws) || 0, 0, 400); }
  if (Array.isArray(a.el) && a.el.length === 49) lk.amb.el = a.el.map(v => int(v, 6000));
  if (a.ek && typeof a.ek === 'object') {
    lk.amb.ek = { air: clamp(Math.round(+a.ek.air) || 0, 0, 100), sawah: clamp(Math.round(+a.ek.sawah) || 0, 0, 100), hutan: clamp(Math.round(+a.ek.hutan) || 0, 0, 100), bangun: clamp(Math.round(+a.ek.bangun) || 0, 0, 100) };
    if (a.ek.sg && typeof a.ek.sg === 'object') lk.amb.ek.sg = { d: int(a.ek.sg.d, 5000), b: clamp(Math.round(+a.ek.sg.b) || 0, 0, 359), ...(typeof a.ek.sg.n === 'string' ? { n: a.ek.sg.n.slice(0, 26) } : {}) };
  }
  return Object.keys(lk.amb).length ? lk : { la: lk.la, lo: lk.lo };
}
